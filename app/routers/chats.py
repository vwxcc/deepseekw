"""Chat CRUD endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, get_owned_chat, require_csrf
from ..models import Chat, User
from ..schemas import ChatCreate, ChatOut, ChatUpdate

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.get("", response_model=list[ChatOut])
async def list_chats(
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Chat).where(Chat.user_id == user.id, Chat.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Chat.title.ilike(f"%{q}%"))
    stmt = stmt.order_by(Chat.updated_at.desc())
    result = await db.execute(stmt)
    return [ChatOut.model_validate(c) for c in result.scalars().all()]


@router.post("", response_model=ChatOut, status_code=status.HTTP_201_CREATED)
async def create_chat(
    data: ChatCreate,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    chat = Chat(user_id=user.id, title=data.title.strip() or "Новый чат")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return ChatOut.model_validate(chat)


@router.get("/{chat_id}", response_model=ChatOut)
async def get_chat(chat: Chat = Depends(get_owned_chat)):
    return ChatOut.model_validate(chat)


@router.patch("/{chat_id}", response_model=ChatOut)
async def rename_chat(
    data: ChatUpdate,
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    chat.title = data.title.strip() or chat.title
    await db.commit()
    await db.refresh(chat)
    return ChatOut.model_validate(chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(chat)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
