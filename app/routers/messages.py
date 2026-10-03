"""Message endpoints: tree retrieval, streaming generation, retry/branch/continue/stop."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
from ..models import (
    Attachment,
    Chat,
    File,
    Message,
    MessageStatus,
    Role,
    RouteType,
    User,
    utcnow,
)
from ..schemas import MessageCreate, MessageOut
from ..services.chats import ancestor_chain, build_message_tree, message_out

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


async def _stream_job(request: Request, job: Job, assistant: Message, user_msg: Message | None):
    if user_msg is not None:
        yield _sse("user_message", _json(message_out(user_msg)))
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
            elif kind == "done":
                finished = True
                yield _sse("done", {"message_id": assistant.id})
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


async def _spawn(
    *,
    request: Request,
    db: AsyncSession,
    chat: Chat,
    parent_message_id: str | None,
    history_messages: list[dict],
) -> StreamingResponse:
    history = prompts.with_system(history_messages, prompts.MAIN_SYSTEM)
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

    history_messages = await ancestor_chain(db, user_msg.id)
    history = prompts.with_system(history_messages, prompts.MAIN_SYSTEM)

    assistant = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content="",
        parent_message_id=user_msg.id,
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
        _stream_job(request, job, assistant, user_msg),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/messages/{message_id}/retry")
async def retry_message(
    request: Request,
    message: Message = Depends(get_owned_message),
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
    )


@router.post("/messages/{message_id}/branch")
async def branch_message(
    request: Request,
    message: Message = Depends(get_owned_message),
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
    )


@router.post("/messages/{message_id}/continue")
async def continue_message(
    request: Request,
    message: Message = Depends(get_owned_message),
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
    )


@router.post("/messages/{message_id}/stop")
async def stop_message(
    message: Message = Depends(get_owned_message),
    _csrf=Depends(require_csrf),
) -> dict:
    return {"ok": ai_router.cancel(message.id)}
