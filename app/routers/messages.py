"""Message endpoints: tree retrieval, streaming generation, retry/branch/continue/stop."""
from __future__ import annotations

import json

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import prompts
from ..ai.router import Job, router as ai_router
from ..deps import (
    get_current_user,
    get_db,
    get_owned_chat,
    get_owned_message,
    require_csrf,
)
from ..config import settings
from ..models import (
    Attachment,
    Chat,
    File,
    Memory,
    Message,
    MessageStatus,
    Role,
    RouteType,
    User,
    utcnow,
)
from ..schemas import (
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
from ..services.websearch import format_context, web_search

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
            elif kind == "thinking":
                yield _sse("thinking", {"text": payload})
            elif kind == "memory":
                try:
                    items = json.loads(payload)
                except Exception:
                    items = []
                if items:
                    yield _sse("memory", {"items": items})
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
            # client went away: stop wasting model time
            job.cancel.set()


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
) -> StreamingResponse:
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

    history = prompts.with_system(history_messages, system_prompt)
    assistant = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content="",
        parent_message_id=parent_message_id,
        status=MessageStatus.queued,
    )
    db.add(assistant)
    chat.updated_at = utcnow()
    await db.commit()
    await db.refresh(assistant)

    job = Job(
        kind="message",
        route_type=RouteType.MAIN,
        chat_id=chat.id,
        history=history,
        message_id=assistant.id,
        effort=effort or chat.effort,
        user_id=user_id,
        mode=mode,
        project=chat.id if mode == "code" else None,
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
        history_messages, settings.model_context_len
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

    # web search is always on
    results = await web_search(content)
    ctx = format_context(results)
    if ctx:
        system_prompt = f"{system_prompt}\n\n{ctx}"

    history = prompts.with_system(history_messages, system_prompt)

    assistant = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content="",
        parent_message_id=user_msg.id,
        status=MessageStatus.queued,
        sources=json.dumps(results, ensure_ascii=False) if results else None,
    )
    db.add(assistant)
    chat.updated_at = utcnow()
    await db.commit()
    await db.refresh(assistant)

    job = Job(
        kind="message",
        route_type=RouteType.MAIN,
        chat_id=chat.id,
        history=history,
        message_id=assistant.id,
        model_set_id=data.model_set_id,
        effort=chat.effort,
        user_id=user.id,
        mode=chat.mode or "chat",
        project=chat.id if code_mode else None,
        user_text=content,
    )
    await ai_router.enqueue(job)
    total = await db.scalar(
        select(func.count()).select_from(Message).where(Message.chat_id == chat.id)
    )
    if total == 2:
        await ai_router.enqueue(
            Job(kind="title", route_type=RouteType.TITLE, chat_id=chat.id, user_text=content)
        )

    return StreamingResponse(
        _stream_job(request, job, assistant, user_msg, user_atts),
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
    for m in rows:
        if m.role == Role.assistant and (m.tokens_in or 0):
            last_in = m.tokens_in
    ctx_len = settings.model_context_len
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


@router.get("/chats/{chat_id}/project")
async def chat_project(
    chat: Chat = Depends(get_owned_chat), db: AsyncSession = Depends(get_db)
) -> dict:
    """File tree of a code-agent project (lives in the shared sandbox directory)."""
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
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    target = max(5, min(85, int(data.target_percent or 50)))
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

    from ..ai import model_sets as ms_mod
    from ..ai.providers import ProviderError, complete_chat

    mset = await ms_mod.get_model_set(db, RouteType.MAIN)
    entries = await ms_mod.get_active_entries(db, mset.id) if mset else []
    if not entries:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Нет активной модели для сжатия"
        )
    entry = entries[0]

    transcript = "\n".join(
        f"{m.role.value}: {(m.content or '')[:1500]}" for m in cut if m.content
    )[:60000]
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
    except ProviderError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Сжатие не удалось: {e}")

    if not summary.strip():
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Модель вернула пустое резюме")

    chat.summary = summary.strip()[:20000]
    chat.summary_upto = cut[-1].id
    await db.commit()
    return await _usage_payload(chat, db)
