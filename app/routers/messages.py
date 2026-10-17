"""Message endpoints: tree retrieval, streaming generation, retry/branch/continue/stop."""
from __future__ import annotations

import asyncio
import json
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import prompts
from ..ai.router import Job, router as ai_router
from ..ai.stream_lifecycle import detach_output_drain
from ..ai.providers import ProviderError, complete_chat
from ..deps import (
    get_current_user,
    get_db,
    get_owned_chat,
    get_owned_message,
    require_csrf,
)
from ..config import settings
from ..database import SessionLocal
from ..models import (
    AudioGeneration,
    Attachment,
    Chat,
    File,
    Memory,
    Message,
    MessageStatus,
    ReadableTextGeneration,
    ModelSet,
    ModelSetEntry,
    Role,
    RouteType,
    User,
    utcnow,
)
from ..schemas import (
    ChatOut,
    CompressIn,
    MessageCreate,
    MessageOut,
    RateIn,
    UsageOut,
)
from ..services.chats import (
    ancestor_chain,
    build_message_tree,
    message_attachments,
    message_out,
)
import logging

from ..services.usage import account, est
from ..services.limits import get_limits
from ..services.audio_quota import (
    AudioQuotaExceeded,
    release_audio_generation,
    reserve_audio_generation,
)
from ..services.audio_state import (
    AudioGenerationInProgress,
    active_audio_generation,
    begin_audio_generation,
    finish_audio_generation,
)
from ..services.sandbox import list_project_files
from ..services.tts import (
    AUDIO_MEDIA_TYPES,
    TTSGenerationError,
    TTSNotConfiguredError,
    audio_file_path,
    generate_speech,
    normalized_audio_format,
    prepare_spoken_text,
)

log = logging.getLogger("chatstudio.messages")

router = APIRouter(prefix="/api", tags=["messages"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _json(model) -> dict:
    return model.model_dump(mode="json")


async def _stream_job(
    request: Request,
    job: Job,
    assistant: Message,
    user_msg: Message | None,
    user_attachments: list | None = None,
):
    if user_msg is not None:
        yield _sse(
            "user_message",
            _json(message_out(user_msg, attachments=user_attachments or [])),
        )
    yield _sse("assistant_message", _json(message_out(assistant)))

    finished = False
    try:
        while True:
            try:
                kind, payload = await asyncio.wait_for(job.output.get(), timeout=900)
            except asyncio.TimeoutError:
                yield _sse("error", {"message_id": assistant.id, "error": "Таймаут генерации"})
                finished = True
                break

            if kind == "delta":
                yield _sse("delta", {"text": payload})
            elif kind == "ui_status":
                yield _sse("ui_status", {"text": str(payload or "")})
            elif kind == "ui_action":
                try:
                    action = json.loads(payload)
                except Exception:
                    action = None
                if isinstance(action, dict) and action.get("text"):
                    yield _sse("ui_action", {
                        "icon": str(action.get("icon") or "sparkle"),
                        "text": str(action["text"]),
                    })
            elif kind == "thinking":
                yield _sse("thinking", {"text": payload})
            elif kind == "memory":
                try:
                    items = json.loads(payload)
                except Exception:
                    items = []
                if items:
                    yield _sse("memory", {"items": items})
            elif kind == "tool_start":
                try:
                    start = json.loads(payload)
                except Exception:
                    start = None
                if start:
                    yield _sse("tool_start", start)
            elif kind == "tool":
                try:
                    run = json.loads(payload)
                except Exception:
                    run = None
                if run:
                    yield _sse("tool", run)
            elif kind == "step":
                try:
                    meta = json.loads(payload)
                except Exception:
                    meta = {}
                yield _sse("step", meta)
            elif kind == "route":
                try:
                    route = json.loads(payload)
                except Exception:
                    route = {}
                if route:
                    yield _sse("route", route)
            elif kind == "stage":
                try:
                    meta = json.loads(payload)
                except Exception:
                    meta = {}
                yield _sse("stage", meta)
            elif kind == "ask":
                try:
                    q = json.loads(payload)
                except Exception:
                    q = None
                if q:
                    yield _sse("ask", q)
            elif kind == "done":
                finished = True
                yield _sse("done", {"message_id": assistant.id, "text": payload})
                break
            elif kind == "error":
                finished = True
                yield _sse("error", {"message_id": assistant.id, "error": payload})
                break
            elif kind == "cancelled":
                finished = True
                yield _sse("cancelled", {"message_id": assistant.id, "text": payload})
                break

            if await request.is_disconnected():
                break
    finally:
        if not finished:
            # Keep the primary generation alive after the browser disconnects, but
            # drain its unbounded event queue until the worker persists the result.
            detach_output_drain(job.output)


def _estimate_chars(messages: list[dict]) -> int:
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            total += sum(len(str(part)) for part in content)
        else:
            total += len(str(content or ""))
    return total


def _trim_history(
    messages: list[dict], context_len: int, reserve: int = 6144
) -> tuple[list[dict], bool]:
    """Drop the oldest turns so the request fits the model window.

    ~2.6 characters per token is a safe estimate for mixed Russian/English text.
    """
    budget = max(4000, int(max(0, context_len - reserve) * 2.6))
    if _estimate_chars(messages) <= budget:
        return messages, False
    trimmed = list(messages)
    while len(trimmed) > 2 and _estimate_chars(trimmed) > budget:
        trimmed.pop(0)
    return trimmed, True


async def _model_context(db: AsyncSession, model_set_id: str | None) -> int:
    """Context window of the concrete model behind a set (0 -> global default)."""
    msid = model_set_id
    if not msid:
        row = (
            await db.execute(
                select(ModelSetEntry)
                .join(ModelSet, ModelSet.id == ModelSetEntry.model_set_id)
                .where(
                    ModelSet.route_type == RouteType.MAIN,
                    ModelSet.is_active.is_(True),
                    ModelSet.is_router.is_(False),
                    ModelSetEntry.is_active.is_(True),
                )
                .order_by(ModelSet.name, ModelSetEntry.position)
                .limit(1)
            )
        ).scalars().first()
    else:
        row = (
            await db.execute(
                select(ModelSetEntry)
                .where(ModelSetEntry.model_set_id == msid)
                .order_by(ModelSetEntry.position)
                .limit(1)
            )
        ).scalars().first()
    if row is not None and (row.context_len or 0) > 0:
        return int(row.context_len)
    return settings.model_context_len


async def _memory_block(db: AsyncSession, user_id: str) -> str:
    """Facts + preferences. Preferences are sent with EVERY request on purpose."""
    res = await db.execute(
        select(Memory)
        .where(Memory.user_id == user_id)
        .order_by(Memory.created_at.desc())
        .limit(60)
    )
    rows = [m for m in res.scalars().all() if m.content]
    facts = [m.content for m in rows if (m.kind or "fact") == "fact"]
    prefs = [m.content for m in rows if (m.kind or "fact") == "preference"]
    out = ""
    if facts:
        out += (
            "\n\n[Что ты помнишь о пользователе]\n"
            + "\n".join("- " + x for x in reversed(facts))
        )
    if prefs:
        out += (
            "\n\n[ПРЕДПОЧТЕНИЯ ПОЛЬЗОВАТЕЛЯ — соблюдай их ВСЕГДА, в каждом ответе]\n"
            + "\n".join("- " + x for x in reversed(prefs))
        )
    return out


async def _spawn(
    *,
    request: Request,
    db: AsyncSession,
    chat: Chat,
    parent_message_id: str | None,
    history_messages: list[dict],
    user_id: str | None = None,
    effort: str | None = None,
    execution_target: str = "site",
) -> StreamingResponse:
    execution_target = execution_target if execution_target in {"site", "device"} else "site"
    mode = chat.mode or "chat"
    system_prompt = prompts.CODE_SYSTEM if mode == "code" else prompts.MAIN_SYSTEM
    history_messages, trimmed = _trim_history(
        history_messages, settings.model_context_len
    )
    if trimmed:
        system_prompt += prompts.CONTEXT_LIMIT_NOTE
    if chat.summary:
        system_prompt += (
            "\n\n[Краткое содержание предыдущего диалога]\n" + chat.summary
        )
    if user_id:
        system_prompt += await _memory_block(db, user_id)
    if execution_target == "device":
        system_prompt += (
            "\n\n[Запуск кода: НА УСТРОЙСТВЕ пользователя. Не выполняй код на сервере "
            "и не используй серверные блоки запуска. Если нужен код, верни его в обычном "
            "блоке кода, чтобы пользователь мог запустить его локально.]"
        )

    assistant = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content="",
        parent_message_id=parent_message_id,
        status=MessageStatus.queued,
        execution_target=execution_target,
    )
    db.add(assistant)
    chat.updated_at = utcnow()
    await db.commit()
    await db.refresh(assistant)

    job = Job(
        kind="message",
        route_type=RouteType.MAIN,
        chat_id=chat.id,
        message_id=assistant.id,
        effort=effort or chat.effort,
        user_id=user_id,
        mode=mode,
        execution_target=execution_target,
        project=chat.id if mode == "code" else None,
        system_prompt=system_prompt,
        history_messages=history_messages,
    )
    await ai_router.enqueue(job)
    return StreamingResponse(
        _stream_job(request, job, assistant, None),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/chats/{chat_id}/messages", response_model=list[MessageOut])
async def get_messages(
    chat: Chat = Depends(get_owned_chat), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.created_at, Message.id)
    )
    return await build_message_tree(db, result.scalars().all())


@router.post("/chats/{chat_id}/messages")
async def send_message(
    request: Request,
    data: MessageCreate,
    chat: Chat = Depends(get_owned_chat),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустое сообщение")
    execution_target = (data.execution_target or "site").strip().lower()
    if execution_target not in {"site", "device"}:
        execution_target = "site"

    parent_id = data.parent_message_id
    if parent_id is not None:
        parent = await db.get(Message, parent_id)
        if parent is None or parent.chat_id != chat.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректный parent_message_id")
    else:
        # no explicit parent: continue from the newest message in the chat
        last = await db.scalar(
            select(Message)
            .where(Message.chat_id == chat.id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        )
        if last is not None:
            parent_id = last.id

    attached: list[File] = []
    for fid in data.attachment_ids or []:
        rec = await db.get(File, fid)
        if rec is None or rec.user_id != user.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Файл {fid} не найден")
        attached.append(rec)

    user_msg = Message(
        chat_id=chat.id,
        user_id=user.id,
        role=Role.user,
        content=content,
        parent_message_id=parent_id,
        status=MessageStatus.completed,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    if attached:
        for rec in attached:
            db.add(Attachment(message_id=user_msg.id, file_id=rec.id))
        await db.commit()

    user_atts = (await message_attachments(db, [user_msg.id])).get(user_msg.id, [])

    if data.effort:
        chat.effort = data.effort

    history_messages = await ancestor_chain(
        db, user_msg.id, summary_upto=chat.summary_upto
    )
    history_messages, trimmed = _trim_history(
        history_messages, await _model_context(db, None)
    )

    code_mode = (chat.mode or "chat") == "code"
    system_prompt = prompts.CODE_SYSTEM if code_mode else prompts.MAIN_SYSTEM
    system_prompt += prompts.STYLE_PROMPTS.get((data.style or "auto").lower(), "")
    if trimmed:
        system_prompt += prompts.CONTEXT_LIMIT_NOTE
    if chat.summary:
        system_prompt += (
            "\n\n[Краткое содержание предыдущего диалога]\n" + chat.summary
        )

    system_prompt += await _memory_block(db, user.id)
    if execution_target == "device":
        system_prompt += (
            "\n\n[Запуск кода: НА УСТРОЙСТВЕ пользователя. Не выполняй код на сервере "
            "и не используй серверные блоки запуска. Если нужен код, верни его в обычном "
            "блоке кода, чтобы пользователь мог запустить его локально.]"
        )

    # The answer must start immediately: web search runs inside the worker, which
    # is also where the query-writing call is billed.
    total = await db.scalar(
        select(func.count()).select_from(Message).where(Message.chat_id == chat.id)
    )
    first_exchange = total == 1  # the user message was just inserted

    assistant = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content="",
        parent_message_id=user_msg.id,
        status=MessageStatus.queued,
        execution_target=execution_target,
    )
    db.add(assistant)
    chat.updated_at = utcnow()
    await db.commit()
    await db.refresh(assistant)

    job = Job(
        kind="message",
        route_type=RouteType.MAIN,
        chat_id=chat.id,
        message_id=assistant.id,
        model_set_id=data.model_set_id,
        effort=chat.effort,
        user_id=user.id,
        mode=chat.mode or "chat",
        execution_target=execution_target,
        project=chat.id if code_mode else None,
        user_text=content,
        system_prompt=system_prompt,
        history_messages=history_messages,
        search_query=content,
        web_search=bool(data.web_search),
        first_exchange=first_exchange,
        max_steps=int((await get_limits(db, user.plan or "free")).get("agent_steps") or 0)
        or None,
    )
    await ai_router.enqueue(job)

    return StreamingResponse(
        _stream_job(request, job, assistant, user_msg, user_atts),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/new-chat/messages")
async def send_first_message(
    request: Request,
    data: MessageCreate,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Create a chat and start its first message through one streaming request."""
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустое сообщение")

    # Validate attachments before creating a chat so invalid uploads do not leave
    # an empty chat behind.
    for fid in data.attachment_ids or []:
        rec = await db.get(File, fid)
        if rec is None or rec.user_id != user.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Файл {fid} не найден")

    # A new chat is always a new root branch.
    data.parent_message_id = None
    chat = Chat(user_id=user.id, title="Новый чат", mode="chat")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    inner_response = await send_message(request, data, chat, user, None, db)
    if not isinstance(inner_response, StreamingResponse):
        return inner_response

    chat_payload = ChatOut.model_validate(chat).model_dump(mode="json")

    async def first_message_stream():
        yield _sse("chat_created", chat_payload)
        async for chunk in inner_response.body_iterator:
            yield chunk

    return StreamingResponse(
        first_message_stream(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/messages/{message_id}/retry")
async def retry_message(
    request: Request,
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    parent_id = message.parent_message_id
    if parent_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нечего повторять")
    chat = await db.get(Chat, message.chat_id)
    history_messages = await ancestor_chain(db, parent_id)
    return await _spawn(
        request=request,
        db=db,
        chat=chat,
        parent_message_id=parent_id,
        history_messages=history_messages,
        user_id=user.id,
        execution_target=message.execution_target or "site",
    )


@router.post("/messages/{message_id}/branch")
async def branch_message(
    request: Request,
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    parent_id = message.parent_message_id
    if parent_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нечего ветвить")
    chat = await db.get(Chat, message.chat_id)
    history_messages = await ancestor_chain(db, parent_id)
    return await _spawn(
        request=request,
        db=db,
        chat=chat,
        parent_message_id=parent_id,
        history_messages=history_messages,
        user_id=user.id,
        execution_target=message.execution_target or "site",
    )


@router.post("/messages/{message_id}/continue")
async def continue_message(
    request: Request,
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    chat = await db.get(Chat, message.chat_id)
    history_messages = await ancestor_chain(db, message.id)
    history_messages.append(
        {
            "role": "user",
            "content": "Продолжи ответ с того места, где остановился. Не повторяй уже сказанное.",
        }
    )
    return await _spawn(
        request=request,
        db=db,
        chat=chat,
        parent_message_id=message.id,
        history_messages=history_messages,
        user_id=user.id,
        execution_target=message.execution_target or "site",
    )


@router.post("/messages/{message_id}/stop")
async def stop_message(
    message: Message = Depends(get_owned_message),
    _csrf=Depends(require_csrf),
) -> dict:
    return {"ok": ai_router.cancel(message.id)}


# ---------- usage / rating / compression ----------

async def _usage_payload(chat: Chat, db: AsyncSession) -> UsageOut:
    res = await db.execute(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.created_at, Message.id)
    )
    rows = list(res.scalars().all())
    tin = sum(m.tokens_in or 0 for m in rows)
    tout = sum(m.tokens_out or 0 for m in rows)
    cached = sum(m.tokens_cached or 0 for m in rows)
    last_in = 0
    last_model_set = None
    for m in rows:
        if m.role == Role.assistant:
            if m.tokens_in or 0:
                last_in = m.tokens_in
            if m.model_set_id:
                last_model_set = m.model_set_id
    ctx_len = await _model_context(db, last_model_set)
    return UsageOut(
        tokens_in=tin,
        tokens_out=tout,
        tokens_cached=cached,
        messages=len(rows),
        avg_in=(tin // len(rows)) if rows else 0,
        percent=round(last_in / ctx_len * 100, 2) if ctx_len else 0.0,
        context_len=ctx_len,
        summary_chars=len(chat.summary or ""),
        effort=chat.effort or "medium",
    )


@router.post("/chats/{chat_id}/seed")
async def seed_chat(
    data: dict,
    chat: Chat = Depends(get_owned_chat),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Insert a prepared assistant message without calling the model.

    Used by the main-page tiles: they create a chat and immediately show the
    questions the user should answer.
    """
    text = str((data or {}).get("text") or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустой текст")
    if (data or {}).get("title"):
        chat.title = str(data["title"])[:200]
    msg = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content=text[:8000],
        parent_message_id=None,
        status=MessageStatus.completed,
    )
    db.add(msg)
    chat.updated_at = utcnow()
    await db.commit()
    await db.refresh(msg)
    return message_out(msg)


@router.get("/chats/{chat_id}/project")
async def chat_project(
    chat: Chat = Depends(get_owned_chat), db: AsyncSession = Depends(get_db)
) -> dict:
    """File tree of a code-agent project (remote runner or shared local directory)."""
    remote_files = await list_project_files(chat.id)
    if remote_files is not None:
        return {"chat_id": chat.id, "mode": chat.mode or "chat", "files": remote_files}

    root = settings.sandbox_path / "projects" / chat.id
    files: list[dict] = []
    if root.is_dir():
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root)
            if any(part in {"__pycache__", ".git"} for part in rel.parts):
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            files.append(
                {"path": str(rel).replace("\\", "/"), "name": path.name, "size": size}
            )
            if len(files) >= 400:
                break
    return {"chat_id": chat.id, "mode": chat.mode or "chat", "files": files}


@router.get("/chats/{chat_id}/usage", response_model=UsageOut)
async def chat_usage(
    chat: Chat = Depends(get_owned_chat), db: AsyncSession = Depends(get_db)
):
    return await _usage_payload(chat, db)


@router.post("/messages/{message_id}/rate")
async def rate_message(
    data: RateIn,
    message: Message = Depends(get_owned_message),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    message.rating = max(-1, min(1, int(data.rating or 0)))
    await db.commit()
    return {"ok": True, "rating": message.rating}


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message: Message = Depends(get_owned_message),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Delete a message together with its whole subtree."""
    chat_id = message.chat_id
    res = await db.execute(select(Message).where(Message.chat_id == chat_id))
    all_msgs = list(res.scalars().all())
    by_parent: dict[str, list[Message]] = {}
    idmap: dict[str, Message] = {}
    for m in all_msgs:
        idmap[m.id] = m
        by_parent.setdefault(m.parent_message_id or "", []).append(m)

    to_delete: list[Message] = []
    stack = [message.id]
    seen: set[str] = set()
    while stack:
        mid = stack.pop()
        if mid in seen:
            continue
        seen.add(mid)
        m = idmap.get(mid)
        if m is None:
            continue
        to_delete.append(m)
        for child in by_parent.get(mid, []):
            stack.append(child.id)

    for m in to_delete:
        await db.delete(m)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/chats/{chat_id}/compress", response_model=UsageOut)
async def compress_chat(
    data: CompressIn,
    chat: Chat = Depends(get_owned_chat),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    limits = await get_limits(db, user.plan or "free")
    cmin = int(limits.get("compress_min") or 5)
    cmax = int(limits.get("compress_max") or 85)
    if cmin > cmax:
        cmin, cmax = cmax, cmin
    raw_target = int(data.target_percent or 50)
    target = max(cmin, min(cmax, raw_target))

    per_day = limits.get("compress_per_day")
    today = utcnow().strftime("%Y-%m-%d")
    if (chat.compress_date or "") != today:
        chat.compress_date = today
        chat.compress_count = 0
    if per_day is not None and (chat.compress_count or 0) >= int(per_day):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Лимит тарифа: сжатий в день — {int(per_day)}. Оформите Pro для снятия лимита.",
        )

    res = await db.execute(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.created_at, Message.id)
    )
    rows = list(res.scalars().all())
    if len(rows) < 4:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "История слишком короткая для сжатия"
        )

    keep = max(2, int(round(len(rows) * (100 - target) / 100.0)))
    cut = rows[: len(rows) - keep]
    if len(cut) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нечего сжимать")

    from ..ai.providers import ProviderError, complete_chat
    from ..ai.router import pool

    try:
        # Use the same primary model as answers and titles; no separate compression chain.
        _, _, chain = await ai_router._resolve_entries(RouteType.MAIN)
    except ProviderError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Нет активной основной модели для сжатия"
        ) from exc

    transcript = "\n".join(
        f"{m.role.value}: {(m.content or '')[:1500]}" for m in cut if m.content
    )[:60000]

    # Use the primary model only; failures are reported instead of switching models.
    summary = ""
    used = None
    last_error = "нет доступной модели"
    tried: set[str] = set()
    while len(tried) < len(chain):
        entry = await pool.acquire(chain, tried)
        if entry is None:
            break
        try:
            summary = await complete_chat(
                messages=[
                    {"role": "system", "content": prompts.COMPRESS_SYSTEM},
                    {"role": "user", "content": transcript},
                ],
                base_url=entry.base_url,
                api_key=entry.api_key,
                model=entry.model,
                temperature=0.3,
                max_tokens=1200,
                timeout=150,
                disable_thinking=True,
            )
            if summary.strip():
                used = entry
                break
            last_error = "модель вернула пустое резюме"
            tried.add(entry.id)
        except ProviderError as e:
            last_error = str(e)
            tried.add(entry.id)
            log.warning("Compression entry %s failed: %s", entry.label, e)
        finally:
            await pool.release(entry)

    if not summary.strip() or used is None:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Сжатие не удалось: {last_error}"
        )

    try:
        _in_tokens = sum(est(m.content) for m in cut)
    except Exception:
        _in_tokens = 0
    await account(
        db,
        chat.id,
        used.model_set_id,
        _in_tokens,
        est(summary),
        entry=used,
        user_id=user.id,
        action="compress",
    )
    chat.summary = summary.strip()[:20000]
    chat.summary_upto = cut[-1].id
    chat.compress_count = (chat.compress_count or 0) + 1
    await db.commit()
    return await _usage_payload(chat, db)


# ---------- response audio / text-to-speech ----------

# A stuck reservation without a resulting file is treated as active for at most
# ten minutes; this also lets another worker/device discover in-flight generation.
_AUDIO_ACTIVITY_STALE_AFTER = timedelta(minutes=10)




def _readable_text_payload(record: ReadableTextGeneration | None) -> dict:
    if record is None:
        return {"status": "missing", "text": None, "error": None}
    return {
        "status": record.status,
        "text": record.text if record.status == "ready" else None,
        "error": record.error if record.status == "failed" else None,
    }


async def _generate_readable_text_background(
    message_id: str, user_id: str, source: str
) -> None:
    """Prepare one answer in the background and persist it for every device."""
    try:
        prepared = (await prepare_spoken_text(source)).strip()
        if not prepared:
            raise TTSGenerationError("ИИ вернул пустой читабельный текст.")
        result_status, error = "ready", None
    except (TTSNotConfiguredError, TTSGenerationError, ValueError) as exc:
        prepared, result_status, error = None, "failed", str(exc)[:500]
    except Exception:
        log.exception("Unexpected readable-text preprocessing error for message %s", message_id)
        prepared, result_status, error = None, "failed", "Не удалось создать читабельный текст из-за внутренней ошибки."

    try:
        async with SessionLocal() as task_db:
            record = await task_db.get(ReadableTextGeneration, message_id)
            if record is None or record.user_id != user_id or record.status != "generating":
                return
            record.status = result_status
            record.text = prepared
            record.error = error
            record.updated_at = utcnow()
            await task_db.commit()
    except Exception:
        log.exception("Could not save readable text status for message %s", message_id)


@router.get("/messages/{message_id}/readable-text")
async def readable_text_status(
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return only the requesting user's cached readable-text status/result."""
    record = await db.get(ReadableTextGeneration, message.id)
    if record is None or record.user_id != user.id:
        return _readable_text_payload(None)
    return _readable_text_payload(record)


@router.post("/messages/{message_id}/readable-text")
async def create_message_readable_text(
    background_tasks: BackgroundTasks,
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Start or reuse the preprocessed text for both server and device playback."""
    if message.role != Role.assistant or message.status != MessageStatus.completed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подготовить текст можно только после готового ответа.")
    source = (message.content or "").strip()
    if not source:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В ответе нет текста для озвучки.")

    result = await db.execute(
        select(ReadableTextGeneration).where(ReadableTextGeneration.message_id == message.id)
    )
    record = result.scalars().first()
    now = utcnow()
    start_background = False

    if record is not None and record.user_id != user.id:
        return _readable_text_payload(None)

    if record is not None and record.status == "ready" and (record.text or "").strip():
        return _readable_text_payload(record)

    if record is not None and record.status == "generating":
        age = now - record.updated_at if record.updated_at else timedelta(minutes=11)
        if age < timedelta(minutes=10):
            return _readable_text_payload(record)
        # Recover a job left unfinished by a worker restart.
        record.text = None
        record.error = None
        record.created_at = now
        record.updated_at = now
        await db.commit()
        start_background = True
    elif record is not None:
        record.status = "generating"
        record.text = None
        record.error = None
        record.created_at = now
        record.updated_at = now
        await db.commit()
        start_background = True
    else:
        record = ReadableTextGeneration(
            message_id=message.id,
            user_id=user.id,
            status="generating",
            created_at=now,
            updated_at=now,
        )
        db.add(record)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            existing = await db.get(ReadableTextGeneration, message.id)
            if existing is not None and existing.user_id == user.id:
                return _readable_text_payload(existing)
            raise HTTPException(status.HTTP_409_CONFLICT, "Не удалось запустить подготовку текста повторно.")
        start_background = True

    if start_background:
        background_tasks.add_task(
            _generate_readable_text_background, message.id, user.id, source
        )
    return _readable_text_payload(record)


@router.get("/messages/{message_id}/audio/status")
async def message_audio_status(
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return cached and in-progress audio state to every authenticated device."""
    try:
        fmt = normalized_audio_format()
        path = audio_file_path(user.id, message.id, fmt)
    except ValueError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Некорректный TTS_RESPONSE_FORMAT.") from exc

    ready = path.is_file()
    generating_message_id = active_audio_generation(user.id)

    # Fall back to shared DB reservations: these are visible across browser
    # sessions and across workers sharing the same database.
    if generating_message_id is None:
        recent = await db.execute(
            select(AudioGeneration)
            .where(
                AudioGeneration.user_id == user.id,
                AudioGeneration.created_at >= utcnow() - _AUDIO_ACTIVITY_STALE_AFTER,
            )
            .order_by(AudioGeneration.created_at.desc())
            .limit(20)
        )
        for reservation in recent.scalars().all():
            try:
                candidate = audio_file_path(user.id, reservation.message_id, fmt)
            except ValueError:
                continue
            if not candidate.is_file():
                generating_message_id = reservation.message_id
                break

    busy = bool(generating_message_id and not (ready and generating_message_id == message.id))
    return {
        "ready": ready,
        "generating": bool(not ready and generating_message_id == message.id),
        "busy": busy,
        "generating_message_id": generating_message_id if busy or not ready else None,
        "url": f"/api/messages/{message.id}/audio/file",
        "format": fmt,
    }


@router.get("/messages/{message_id}/audio/file")
async def get_message_audio(
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
):
    """Stream the generated audio only to the owner of the original message."""
    try:
        fmt = normalized_audio_format()
        path = audio_file_path(user.id, message.id, fmt)
    except ValueError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Некорректный TTS_RESPONSE_FORMAT.") from exc
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Аудиоверсия ещё не создана.")
    return FileResponse(
        path,
        media_type=AUDIO_MEDIA_TYPES[fmt],
        filename=f"answer-{message.id}.{fmt}",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/messages/{message_id}/audio")
async def create_message_audio(
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generate speech while allowing no parallel generation for one account."""
    if message.role != Role.assistant or message.status != MessageStatus.completed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Озвучить можно только готовый ответ ассистента.")
    source = (message.content or "").strip()
    if not source:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В ответе нет текста для озвучки.")
    try:
        fmt = normalized_audio_format()
        path = audio_file_path(user.id, message.id, fmt)
    except ValueError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Некорректный TTS_RESPONSE_FORMAT.") from exc

    # Cached playback is free and should not block a new generation.
    if path.is_file():
        return {
            "ready": True,
            "url": f"/api/messages/{message.id}/audio/file",
            "format": fmt,
            "size": path.stat().st_size,
        }

    readable = await db.get(ReadableTextGeneration, message.id)
    if (
        readable is None
        or readable.user_id != user.id
        or readable.status != "ready"
        or not (readable.text or "").strip()
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Сначала дождитесь создания читабельного текста.",
        )
    source = readable.text.strip()

    try:
        begin_audio_generation(user.id, message.id)
    except AudioGenerationInProgress as exc:
        if exc.message_id == message.id:
            detail = "Озвучка этого ответа уже создаётся на другом устройстве."
        else:
            detail = "Уже создаётся другая озвучка. Дождитесь её завершения."
        raise HTTPException(status.HTTP_409_CONFLICT, detail) from exc

    reservation = None

    async def release_reservation() -> None:
        try:
            await release_audio_generation(db, reservation)
        except Exception:
            log.exception("Could not release audio quota reservation for message %s", message.id)

    try:
        try:
            reservation = await reserve_audio_generation(
                db, user.id, message.id, user.plan or "free"
            )
        except AudioQuotaExceeded as exc:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc

        try:
            audio_bytes, generated_format = await generate_speech(source, prepared=True)
            if generated_format != fmt:
                raise HTTPException(
                    status.HTTP_500_INTERNAL_SERVER_ERROR,
                    "Формат аудио изменился во время генерации.",
                )
            path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(path.write_bytes, audio_bytes)
        except TTSNotConfiguredError as exc:
            await release_reservation()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
        except ValueError as exc:
            await release_reservation()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        except TTSGenerationError as exc:
            await release_reservation()
            log.warning("TTS generation failed for message %s: %s", message.id, exc)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
        except OSError as exc:
            await release_reservation()
            log.exception("Could not persist TTS audio for message %s", message.id)
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "Не удалось сохранить аудиофайл."
            ) from exc
        except BaseException:
            await release_reservation()
            raise

        return {
            "ready": True,
            "url": f"/api/messages/{message.id}/audio/file",
            "format": fmt,
            "size": path.stat().st_size,
        }
    finally:
        finish_audio_generation(user.id, message.id)


