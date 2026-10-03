"""Public (shared) chat access — reading requires no authentication."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import Chat, Message, Role, User
from ..schemas import ChatOut, PublicChatOut
from ..services.chats import build_message_tree

router = APIRouter(prefix="/api/public", tags=["public"])


async def _find_public(db: AsyncSession, token: str) -> Chat:
    result = await db.execute(
        select(Chat).where(
            Chat.share_token == token,
            Chat.is_public.is_(True),
            Chat.deleted_at.is_(None),
        )
    )
    chat = result.scalar_one_or_none()
    if chat is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Чат не найден или ссылка отключена"
        )
    return chat


@router.get("/chats/{token}", response_model=PublicChatOut)
async def public_chat(token: str, db: AsyncSession = Depends(get_db)):
    chat = await _find_public(db, token)
    msgs = await db.execute(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.created_at, Message.id)
    )
    tree = await build_message_tree(db, list(msgs.scalars().all()))
    author = await db.get(User, chat.user_id)
    return PublicChatOut(
        title=chat.title,
        created_at=chat.created_at,
        author=(author.name or author.email) if author else "",
        messages=tree,
    )


@router.post("/chats/{token}/fork", response_model=ChatOut)
async def fork_chat(
    token: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Copy a shared chat into your account so you can continue it."""
    src = await _find_public(db, token)

    new_chat = Chat(user_id=user.id, title=src.title)
    db.add(new_chat)
    await db.flush()

    msgs = await db.execute(
        select(Message)
        .where(Message.chat_id == src.id)
        .order_by(Message.created_at, Message.id)
    )
    id_map: dict[str, str] = {}
    for m in msgs.scalars().all():
        new_id = str(uuid.uuid4())
        id_map[m.id] = new_id
        db.add(
            Message(
                id=new_id,
                chat_id=new_chat.id,
                user_id=user.id if m.role == Role.user else None,
                role=m.role,
                content=m.content,
                parent_message_id=id_map.get(m.parent_message_id or ""),
                status=m.status,
                created_at=m.created_at,
            )
        )
    await db.commit()
    await db.refresh(new_chat)
    return ChatOut.model_validate(new_chat)
