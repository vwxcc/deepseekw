"""User memory: what the assistant remembers about the user."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import Chat, Memory, Message, User
from ..schemas import MemoryIn, MemoryOut

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("", response_model=list[MemoryOut])
async def list_memory(
    chat_id: str | None = None,
    message_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if message_id:
        message = await db.get(Message, message_id)
        chat = await db.get(Chat, message.chat_id) if message else None
        if chat is None or chat.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Сообщение не найдено")
        if chat_id and chat_id != chat.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сообщение относится к другому чату")
        chat_id = chat.id

    stmt = select(Memory).where(Memory.user_id == user.id)
    if chat_id:
        chat = await db.get(Chat, chat_id)
        if chat is None or chat.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Чат не найден")
        if message_id:
            stmt = stmt.where(Memory.message_id == message_id)
        else:
            stmt = stmt.where(
                or_(
                    Memory.chat_id == chat_id,
                    and_(Memory.chat_id.is_(None), Memory.message_id.is_(None)),
                )
            )
    result = await db.execute(stmt.order_by(Memory.created_at.desc()))
    return [MemoryOut.model_validate(m) for m in result.scalars().all()]


@router.post("", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
async def add_memory(
    data: MemoryIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустая заметка")
    kind = (data.kind or "fact").strip().lower()
    if kind not in ("fact", "preference"):
        kind = "fact"
    chat_id = data.chat_id
    if data.message_id:
        message = await db.get(Message, data.message_id)
        message_chat = await db.get(Chat, message.chat_id) if message else None
        if message_chat is None or message_chat.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Сообщение не найдено")
        if chat_id and chat_id != message_chat.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сообщение относится к другому чату")
        chat_id = message_chat.id
    if chat_id:
        chat = await db.get(Chat, chat_id)
        if chat is None or chat.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Чат не найден")

    rec = Memory(
        user_id=user.id,
        content=content[:2000],
        kind=kind,
        chat_id=chat_id,
        message_id=data.message_id,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return MemoryOut.model_validate(rec)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(Memory, memory_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заметка не найдена")
    await db.delete(rec)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_memory(
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Memory).where(Memory.user_id == user.id))
    for rec in result.scalars().all():
        await db.delete(rec)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
