"""Message endpoints: tree retrieval, streaming generation, retry/branch/continue/stop."""
from __future__ import annotations

import asyncio
import json
import math
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

from ..services.usage import account, est, window_spend as usage_window_spend
from ..services.limits import get_limits
from ..services.audio_quota import (
    AudioQuotaExceeded,
    release_audio_generation,
    reserve_audio_generation,
)
from ..services.audio_state import (
    AudioGenerationInProgress,
    active_audio_generation,
    audio_generation_error,
    begin_audio_generation,
    finish_audio_generation,
    set_audio_generation_error,
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


def _last_user_text(messages: list[dict]) -> str:
    """Find the most recent actual user request, skipping the synthetic continue prompt."""
    for item in reversed(messages or []):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            value = content.strip()
        elif isinstance(content, list):
            value = "\n".join(
                str(part.get("text") or "").strip()
                for part in content
                if isinstance(part, dict) and part.get("type") in {"text", "input_text"}
                and str(part.get("text") or "").strip()
            ).strip()
        else:
            continue
        if not value or value.startswith("Продолжи ответ с того места, где остановился."):
            continue
        return value[:8000]
    return ""


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


async def _request_context_block(
    request: Request, db: AsyncSession, user: User, client_context: dict | None = None
) -> str:
    """Build a compact, privacy-limited account/device context for the model."""
    raw = client_context if isinstance(client_context, dict) else {}

    def short_text(key: str, limit: int = 120) -> str | None:
        value = raw.get(key)
        if not isinstance(value, str):
            return None
        value = value.strip()
        return value[:limit] if value else None

    def bounded_int(key: str, minimum: int, maximum: int) -> int | None:
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if not math.isfinite(float(value)) or not float(value).is_integer():
            return None
        return max(minimum, min(maximum, int(value)))

    def bounded_float(key: str, minimum: float, maximum: float) -> float | None:
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        number = float(value)
        if not math.isfinite(number):
            return None
        return round(max(minimum, min(maximum, number)), 2)

    limits = await get_limits(db, user.plan or "free")
    allowed = (
        "file_size", "user_storage", "files_count", "posts", "code_agents", "agent_steps",
        "council_members", "chats_count", "audio_generations", "sandbox_seconds",
        "compress_min", "compress_max", "compress_per_day", "budget_usd", "window_hours",
    )
    safe_limits = {key: limits.get(key) for key in allowed if key in limits}
    hours = max(1, int(limits.get("window_hours") or 5))
    spent, calls = await usage_window_spend(db, user.id, hours)
    budget_raw = limits.get("budget_usd")
    budget = float(budget_raw) if budget_raw is not None else None
    file_count = await db.scalar(select(func.count()).select_from(File).where(File.user_id == user.id))
    storage_bytes = await db.scalar(select(func.coalesce(func.sum(File.size), 0)).where(File.user_id == user.id))
    chat_count = await db.scalar(select(func.count()).select_from(Chat).where(
        Chat.user_id == user.id, Chat.deleted_at.is_(None)
    ))
    message_count = await db.scalar(select(func.count()).select_from(Message).join(
        Chat, Chat.id == Message.chat_id
    ).where(Chat.user_id == user.id))

    device: dict[str, object] = {
        "server_time_utc": utcnow().isoformat(),
        "server_user_agent": (request.headers.get("user-agent") or "")[:300],
    }
    for key, limit in (
        ("captured_at", 40), ("timezone", 80), ("locale", 35), ("platform", 100),
        ("color_scheme", 12), ("network_effective_type", 20),
    ):
        value = short_text(key, limit)
        if value is not None:
            device[key] = value
    langs = raw.get("languages")
    if isinstance(langs, list):
        device["languages"] = [v.strip()[:35] for v in langs if isinstance(v, str) and v.strip()][:5]
    for key, low, high in (
        ("screen_width_px", 0, 20000), ("screen_height_px", 0, 20000),
        ("viewport_width_px", 0, 20000), ("viewport_height_px", 0, 20000),
        ("color_depth", 0, 128), ("touch_points", 0, 100), ("hardware_concurrency", 1, 512),
    ):
        value = bounded_int(key, low, high)
        if value is not None:
            device[key] = value
    for key, low, high in (("pixel_ratio", 0.25, 10), ("device_memory_gb", 0.25, 1024)):
        value = bounded_float(key, low, high)
        if value is not None:
            device[key] = value
    for key in ("mobile", "online", "network_save_data", "reduced_motion", "standalone"):
        value = raw.get(key)
        if isinstance(value, bool):
            device[key] = value

    payload = {
        "account": {
            "display_name": (user.name or "")[:120],
            "subscription_plan": user.plan or "free",
            "is_admin": bool(user.is_admin),
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "limits": safe_limits,
        "current_window": {
            "hours": hours, "billed_calls": int(calls or 0),
            "spend_usd": round(float(spent or 0), 6), "budget_usd": budget,
            "budget_remaining_usd": round(max(0.0, budget - float(spent or 0)), 6) if budget is not None else None,
        },
        "usage": {
            "files": int(file_count or 0), "storage_bytes": int(storage_bytes or 0),
            "active_chats": int(chat_count or 0), "messages": int(message_count or 0),
        },
        "device_and_time": device,
    }
    return (
        "\n\n[КОНТЕКСТ АККАУНТА, ЛИМИТОВ И УСТРОЙСТВА. Используй для адаптации ответа; "
        "не раскрывай без необходимости. Цены тарифов и ставки за токены не передаются. "
        "Данные устройства предоставлены браузером и могут быть неполными.]\n"
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )


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
    execution_target = execution_target if execution_target in {"site", "device", "both"} else "site"
    mode = chat.mode or "chat"
    system_prompt = prompts.CODE_SYSTEM if mode == "code" else prompts.MAIN_SYSTEM
    system_prompt += prompts.skills_for(_last_user_text(history_messages))
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
        context_user = await db.get(User, user_id)
        if context_user is not None:
            system_prompt += await _request_context_block(request, db, context_user)
    if execution_target == "device":
        system_prompt += (
            "\n\n[Запуск кода: НА УСТРОЙСТВЕ пользователя. Не выполняй код на сервере "
            "и не используй серверные блоки запуска. Если нужен код, верни его в обычном "
            "блоке кода, чтобы пользователь мог запустить его локально.]"
        )
    elif execution_target == "both":
        system_prompt += (
            "\n\n[Параллельная попытка выполнения кода. Если для текущего запроса нужен "
            "реальный запуск, вычисление, обработка данных или создание файла, подготовь один "
            "законченный переносимый блок Python с языком run. Сервер запустит его в своей "
            "изолированной песочнице, а браузер одновременно попробует запустить ТОТ ЖЕ код "
            "локально. Не предполагай, что на обоих исполнителях установлены одни и те же "
            "сторонние библиотеки: по возможности используй стандартную библиотеку, а если "
            "нужна внешняя библиотека, аккуратно обработай её отсутствие. Результаты и "
            "созданные файлы могут отличаться; указывай только реально полученные результаты. "
            "Не используй секреты и не создавай опасные побочные эффекты. Для HTML/JS-интерфейса "
            "предоставь обычный блок кода для локального превью; не выдавай его за серверное исполнение.]"
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


async def _check_budget_before_send(user: User, db: AsyncSession) -> None:
    """Reject exhausted accounts before persisting another user message or empty chat."""
    limits = await get_limits(db, user.plan or "free")
    budget_value = limits.get("budget_usd")
    if budget_value is None:
        return
    budget = max(0.0, float(budget_value))
    hours = max(1, int(limits.get("window_hours") or 5))
    spent, _ = await usage_window_spend(db, user.id, hours)
    if spent >= budget:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Лимит исчерпан: ${spent:.2f} из ${budget:.2f} за последние {hours} ч. "
            "Это скользящее окно: новые запросы откроются, когда старые расходы выйдут из окна.",
        )


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
    await _check_budget_before_send(user, db)
    execution_target = (data.execution_target or "site").strip().lower()
    if execution_target not in {"site", "device", "both"}:
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
    system_prompt += prompts.skills_for(content)
    system_prompt += prompts.STYLE_PROMPTS.get((data.style or "auto").lower(), "")
    if trimmed:
        system_prompt += prompts.CONTEXT_LIMIT_NOTE
    if chat.summary:
        system_prompt += (
            "\n\n[Краткое содержание предыдущего диалога]\n" + chat.summary
        )

    system_prompt += await _memory_block(db, user.id)
    system_prompt += await _request_context_block(request, db, user, data.client_context)
    if execution_target == "device":
        system_prompt += (
            "\n\n[Запуск кода: НА УСТРОЙСТВЕ пользователя. Не выполняй код на сервере "
            "и не используй серверные блоки запуска. Если нужен код, верни его в обычном "
            "блоке кода, чтобы пользователь мог запустить его локально.]"
        )
    elif execution_target == "both":
        system_prompt += (
            "\n\n[Параллельная попытка выполнения кода. Если для текущего запроса нужен "
            "реальный запуск, вычисление, обработка данных или создание файла, подготовь один "
            "законченный переносимый блок Python с языком run. Сервер запустит его в своей "
            "изолированной песочнице, а браузер одновременно попробует запустить ТОТ ЖЕ код "
            "локально. Не предполагай, что на обоих исполнителях установлены одни и те же "
            "сторонние библиотеки: по возможности используй стандартную библиотеку, а если "
            "нужна внешняя библиотека, аккуратно обработай её отсутствие. Результаты и "
            "созданные файлы могут отличаться; указывай только реально полученные результаты. "
            "Не используй секреты и не создавай опасные побочные эффекты. Для HTML/JS-интерфейса "
            "предоставь обычный блок кода для локального превью; не выдавай его за серверное исполнение.]"
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
    await _check_budget_before_send(user, db)

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


@router.post("/messages/{message_id}/attachments")
async def attach_message_files(
    data: dict,
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Persist generated files as normal owned files linked to their message."""
    raw_ids = data.get("file_ids") if isinstance(data, dict) else None
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Не переданы ID файлов")
    file_ids = list(dict.fromkeys(value for value in raw_ids if isinstance(value, str) and value.strip()))
    if not file_ids or len(file_ids) != len(raw_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректный список файлов")
    if len(file_ids) > settings.max_files_per_request:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Слишком много файлов за один запрос")
    result = await db.execute(select(File).where(File.user_id == user.id, File.id.in_(file_ids)))
    owned_files = result.scalars().all()
    if len(owned_files) != len(file_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Один или несколько файлов не найдены")
    existing = await db.execute(select(Attachment).where(Attachment.message_id == message.id))
    linked = {item.file_id for item in existing.scalars().all()}
    for file_id in file_ids:
        if file_id not in linked:
            db.add(Attachment(message_id=message.id, file_id=file_id))
    await db.commit()
    return (await message_attachments(db, [message.id])).get(message.id, [])


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
        "error": audio_generation_error(user.id, message.id) if not ready else None,
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


async def _generate_queued_message_audio(
    user_id: str, message_id: str, reservation_id: str
) -> None:
    """Generate audio server-side after the readable-text job is finished.

    This task belongs to FastAPI's background queue, not to the browser request.
    Closing the tab therefore does not cancel audio generation.
    """
    success = False
    try:
        # The text-preparation task is scheduled before this one when needed.
        # Poll persisted state as a fallback for jobs started by another worker.
        deadline = asyncio.get_running_loop().time() + 15 * 60
        source = ""
        while asyncio.get_running_loop().time() < deadline:
            async with SessionLocal() as task_db:
                readable = await task_db.get(ReadableTextGeneration, message_id)
                if readable is not None and readable.user_id == user_id:
                    if readable.status == "ready" and (readable.text or "").strip():
                        source = readable.text.strip()
                        break
                    if readable.status == "failed":
                        detail = str(readable.error or "").strip()
                        raise TTSGenerationError(
                            "Не удалось подготовить читабельный текст"
                            + (": " + detail if detail else ".")
                        )
            await asyncio.sleep(1)
        if not source:
            raise TTSGenerationError(
                "Подготовка читабельного текста не завершилась за отведённое время."
            )

        fmt = normalized_audio_format()
        path = audio_file_path(user_id, message_id, fmt)
        if not path.is_file():
            audio_bytes, generated_format = await generate_speech(source, prepared=True)
            if generated_format != fmt:
                raise TTSGenerationError("Формат аудио изменился во время генерации.")
            path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(path.write_bytes, audio_bytes)
        success = True
        set_audio_generation_error(user_id, message_id, None)
        log.info("Queued TTS generation completed for message %s", message_id)
    except Exception as exc:
        detail = str(exc).strip() or "Не удалось создать ИИ-озвучку."
        set_audio_generation_error(user_id, message_id, detail)
        log.warning("Queued TTS generation failed for message %s: %s", message_id, detail)
        # Failed jobs do not consume a successful audio-generation quota slot.
        try:
            async with SessionLocal() as task_db:
                reservation = await task_db.get(AudioGeneration, reservation_id)
                if reservation is not None:
                    await release_audio_generation(task_db, reservation)
        except Exception:
            log.exception("Could not release failed TTS reservation for message %s", message_id)
    finally:
        finish_audio_generation(user_id, message_id)


@router.post("/messages/{message_id}/audio")
async def create_message_audio(
    background_tasks: BackgroundTasks,
    message: Message = Depends(get_owned_message),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Queue speech generation on the server; clients may close after enqueueing."""
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

    # Cached playback remains immediate and does not consume a new quota slot.
    if path.is_file():
        return {
            "ready": True,
            "generating": False,
            "queued": False,
            "url": f"/api/messages/{message.id}/audio/file",
            "format": fmt,
            "size": path.stat().st_size,
        }

    try:
        begin_audio_generation(user.id, message.id)
    except AudioGenerationInProgress as exc:
        if exc.message_id == message.id:
            detail = "Озвучка этого ответа уже создаётся. Она продолжится на сервере."
        else:
            detail = "Уже создаётся другая озвучка. Дождитесь её завершения."
        raise HTTPException(status.HTTP_409_CONFLICT, detail) from exc

    reservation = None
    try:
        try:
            reservation = await reserve_audio_generation(
                db, user.id, message.id, user.plan or "free"
            )
        except AudioQuotaExceeded as exc:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc

        # Reuse the established readable-text state machine. If the text is not
        # ready, it adds its preparation task before the queued audio task below.
        await create_message_readable_text(
            background_tasks, message, user, None, db
        )
        background_tasks.add_task(
            _generate_queued_message_audio,
            str(user.id), str(message.id), str(reservation.id),
        )
    except Exception:
        if reservation is not None:
            try:
                await release_audio_generation(db, reservation)
            except Exception:
                log.exception("Could not release queued TTS reservation for message %s", message.id)
        finish_audio_generation(user.id, message.id)
        raise

    return {
        "ready": False,
        "generating": True,
        "queued": True,
        "url": f"/api/messages/{message.id}/audio/file",
        "format": fmt,
    }
