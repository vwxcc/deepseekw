"""FastAPI dependencies: DB session, current user, CSRF, admin, ownership."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import SessionLocal
from .models import Chat, Message, Session, User
from .security import hash_token, verify_csrf

COOKIE_NAME = "chatstudio_session"


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    result = await db.execute(
        select(Session).where(Session.token_hash == hash_token(token))
    )
    sess = result.scalar_one_or_none()
    if sess is None or sess.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")

    result = await db.execute(select(User).where(User.id == sess.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    request.state.session_token = token
    return user


async def require_csrf(
    request: Request, user: User = Depends(get_current_user)
) -> None:
    session_token = getattr(request.state, "session_token", None)
    provided = request.headers.get("X-CSRF-Token")
    if not verify_csrf(session_token, provided):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


async def get_owned_chat(
    chat_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    chat = await db.get(Chat, chat_id)
    if chat is None or chat.user_id != user.id or chat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    return chat


async def get_owned_message(
    message_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    chat = await db.get(Chat, msg.chat_id)
    if chat is None or chat.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    return msg
