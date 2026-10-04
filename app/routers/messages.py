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
from ..ai.providers import ProviderError, complete_chat
import re
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
    ModelSet,
    ModelSetEntry,
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
import logging

from ..services.usage import account, est
from ..services.websearch import format_context, web_search
from ..services.limits import get_limits

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


async def _model_context(db: AsyncSession, model_set_id: str | None) -> int:
    """Context window of the concrete model behind a set (0 -> global default)."""
    msid = model_set_id
    if not msid:
        row = (
            await db.execute(
                select(ModelSetEntry)
                .join(ModelSet, ModelSet.id == ModelSetEntry.model_set_id)
                .where(ModelSet.route_type == RouteType.MAIN, ModelSet.is_router.is_(False))
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


SEARCH_QUERIES_SYSTEM = (
    "Ты составляешь поисковые запросы для интернет-поиска. На входе — сообщение "
    "пользователя. Верни от 1 до 3 коротких поисковых запросов (2-5 слов каждый), "
    "по одному на строку, без нумерации, кавычек и пояснений — только то, что реально "
    "надо найти. Если поиск не нужен (простой вопрос, математика, рассуждение, код) — "
    "верни ровно одно слово NONE."
)


async def _main_entry(db: AsyncSession, model_set_id: str | None):
    """The concrete model entry that will answer (for the query-writing call)."""
    if model_set_id:
        row = (
            await db.execute(
                select(ModelSetEntry)
                .where(ModelSetEntry.model_set_id == model_set_id)
                .order_by(ModelSetEntry.position)
                .limit(1)
            )
        ).scalars().first()
        if row is not None:
            return row
    return (
        await db.execute(
            select(ModelSetEntry)
            .join(ModelSet, ModelSet.id == ModelSetEntry.model_set_id)
            .where(ModelSet.route_type == RouteType.MAIN, ModelSet.is_router.is_(False))
            .order_by(ModelSet.name, ModelSetEntry.position)
            .limit(1)
        )
    ).scalars().first()


async def _smart_search(
    message: str, db: AsyncSession, model_set_id: str | None, chat_id: str | None = None
) -> list[dict]:
    """Let the model write the queries, then search with each of them."""
    queries: list[str] = []
    answer = ""
    try:
        entry = await _main_entry(db, model_set_id)
        if entry is not None:
            answer = await complete_chat(
                messages=[
                    {"role": "system", "content": SEARCH_QUERIES_SYSTEM},
                    {"role": "user", "content": (message or "")[:1500]},
                ],
                base_url=entry.base_url,
                api_key=entry.api_key,
                model=entry.model,
                temperature=0.0,
                max_tokens=120,
                timeout=min(entry.timeout or 60, 45),
                disable_thinking=True,
            )
            text = (answer or "").strip()
            if text and "NONE" not in text.upper():
                for line in text.splitlines():
                    q = re.sub(r"^[\s\-*\d.)]+", "", line).strip()
                    q = q.replace('\u00ab', '').replace('\u00bb', '')
                    q = q.strip('"').strip("'").strip()
                    if 2 < len(q) <= 120:
                        queries.append(q)
    except Exception as e:  # noqa: BLE001 - search must never break a chat
        log.warning("Query generation failed: %s", e)

    if not queries:
        # fall back to keywords: long phrases return nothing from the engine
        words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", (message or "").lower())
        stop = {
            "какой", "какая", "какие", "сколько", "сейчас", "сегодня", "покажи",
            "расскажи", "найди", "поищи", "что", "как", "где", "когда", "почему",
            "мне", "нужно", "хочу", "можно", "есть", "это", "the", "and", "for",
            "про", "для", "или", "если", "тоже", "очень", "самый", "самая",
        }
        key = [w for w in words if w not in stop][:6]
        queries = [" ".join(key) if key else (message or "").strip()]
    queries = [q for q in queries if q][:3]

    out: list[dict] = []
    seen: set[str] = set()
    for q in queries:
        try:
            for item in await web_search(q):
                url = item.get("url") or ""
                if url and url not in seen:
                    seen.add(url)
                    out.append(item)
        except Exception as e:  # noqa: BLE001
            log.warning("Search failed for %r: %s", q[:60], e)
    log.info("Search queries=%s results=%d", queries, len(out))
    if chat_id and answer:
        try:
            await account(db, chat_id, model_set_id, est(message), est(answer))
            await db.commit()
        except Exception as e:  # noqa: BLE001
            log.warning("Search accounting failed: %s", e)
    return out[:6]


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
        history_messages, await _model_context(db, data.model_set_id)
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

    # web search is always on: the model writes its own short queries first
    results = await _smart_search(content, db, data.model_set_id, chat.id)
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
        max_steps=int((await get_limits(db, user.plan or "free")).get("agent_steps") or 0)
        or None,
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

    try:
        _in_tokens = sum(est(m.content) for m in cut)
    except Exception:
        _in_tokens = 0
    await account(db, chat.id, data.model_set_id, _in_tokens, est(summary))
    chat.summary = summary.strip()[:20000]
    chat.summary_upto = cut[-1].id
    chat.compress_count = (chat.compress_count or 0) + 1
    await db.commit()
    return await _usage_payload(chat, db)
