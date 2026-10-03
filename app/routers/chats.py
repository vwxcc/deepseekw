"""Chat CRUD endpoints."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, get_owned_chat, require_csrf
from ..models import Chat, User
from ..schemas import ChatCreate, ChatOut, ChatUpdate, ShareOut

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


def _share_url(token: str | None) -> str | None:
    return f"/?share={token}" if token else None


@router.get("/{chat_id}/share", response_model=ShareOut)
async def share_status(chat: Chat = Depends(get_owned_chat)):
    return ShareOut(
        is_public=chat.is_public,
        share_token=chat.share_token,
        url=_share_url(chat.share_token) if chat.is_public else None,
    )


@router.post("/{chat_id}/share", response_model=ShareOut)
async def share_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    if not chat.share_token:
        chat.share_token = uuid.uuid4().hex
    chat.is_public = True
    await db.commit()
    return ShareOut(
        is_public=True, share_token=chat.share_token, url=_share_url(chat.share_token)
    )


@router.delete("/{chat_id}/share", response_model=ShareOut)
async def unshare_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    chat.is_public = False
    await db.commit()
    return ShareOut(is_public=False, share_token=chat.share_token, url=None)
