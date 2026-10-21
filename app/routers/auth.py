"""Auth endpoints: register, login, logout, me, csrf."""
from __future__ import annotations

import random
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import SessionLocal
from ..deps import COOKIE_NAME, get_current_user, get_db
from ..models import (
    AudioGeneration, Chat, File, Memory, Message, Project, ReadableTextGeneration,
    ScheduledItem, Session, UsageEvent, User, UserSkill,
)
from ..schemas import AuthOut, LoginIn, RegisterIn, UserOut
from ..security import (
    csrf_token_for,
    generate_session_token,
    hash_password,
    hash_token,
    session_expiry,
    verify_password,
)
from ..services.avatars import AVATAR_COUNT

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookies(response: Response, token: str, max_age: int | None = None) -> None:
    cookie_age = settings.session_max_age if max_age is None else max(1, int(max_age))
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=cookie_age,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )
    response.set_cookie(
        "chatstudio_csrf",
        csrf_token_for(token),
        max_age=cookie_age,
        httponly=False,
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )


GUEST_SESSION_SECONDS = 3 * 24 * 60 * 60
GUEST_EMAIL_SUFFIX = "@guest.ai-ch.invalid"


def _is_guest(user: User | None) -> bool:
    return bool(user is not None and getattr(user, "is_guest", False))


async def _start_session(
    db: AsyncSession, user: User, lifetime_seconds: int | None = None
) -> str:
    token = generate_session_token()
    expires_at = session_expiry()
    if lifetime_seconds is not None:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=lifetime_seconds)
        ).replace(tzinfo=None)
    db.add(Session(token_hash=hash_token(token), user_id=user.id, expires_at=expires_at))
    await db.commit()
    return token


async def _claim_guest_data(request: Request, db: AsyncSession, user: User) -> None:
    """Move the active browser guest's content into the account being opened."""
    raw_token = request.cookies.get(COOKIE_NAME)
    if not raw_token:
        return
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    session_result = await db.execute(select(Session).where(Session.token_hash == hash_token(raw_token)))
    guest_session = session_result.scalar_one_or_none()
    if guest_session is None or guest_session.expires_at <= now:
        return
    guest = await db.get(User, guest_session.user_id)
    if guest is None or guest.id == user.id or not _is_guest(guest):
        return
    for model in (
        Chat, Message, File, Memory, Project, ScheduledItem, UserSkill,
        AudioGeneration, ReadableTextGeneration,
    ):
        await db.execute(update(model).where(model.user_id == guest.id).values(user_id=user.id))
    # Preserve global provider-cost accounting without assigning guest spend to the new account.
    await db.execute(update(UsageEvent).where(UsageEvent.user_id == guest.id).values(user_id=None))
    await db.delete(guest)


async def cleanup_expired_guests() -> int:
    """Remove guest accounts and their stored uploads once all their sessions expire."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    upload_root = Path(settings.upload_dir).expanduser().resolve()
    removed = 0
    async with SessionLocal() as db:
        active_session = select(Session.id).where(
            Session.user_id == User.id,
            Session.expires_at > now,
        ).exists()
        result = await db.execute(select(User).where(User.is_guest.is_(True), ~active_session))
        guests = result.scalars().all()
        for guest in guests:
            file_result = await db.execute(select(File).where(File.user_id == guest.id))
            for stored_file in file_result.scalars().all():
                candidate = Path(stored_file.storage_path)
                if not candidate.is_absolute():
                    candidate = upload_root / candidate
                try:
                    resolved = candidate.resolve()
                    resolved.relative_to(upload_root)
                    resolved.unlink(missing_ok=True)
                except (OSError, RuntimeError, ValueError):
                    # Never delete files outside the configured upload directory.
                    pass
            await db.execute(update(UsageEvent).where(UsageEvent.user_id == guest.id).values(user_id=None))
            await db.delete(guest)
            removed += 1
        if removed:
            await db.commit()
    return removed


@router.post("/guest", response_model=AuthOut)
async def create_guest_session(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> AuthOut:
    """Create or reuse a free guest identity whose server-side lifetime is three days."""
    raw_token = request.cookies.get(COOKIE_NAME)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if raw_token:
        result = await db.execute(select(Session).where(Session.token_hash == hash_token(raw_token)))
        existing_session = result.scalar_one_or_none()
        if existing_session is not None and existing_session.expires_at > now:
            existing_user = await db.get(User, existing_session.user_id)
            if existing_user is not None:
                remaining = max(1, int((existing_session.expires_at - now).total_seconds()))
                cookie_age = remaining if _is_guest(existing_user) else settings.session_max_age
                _set_cookies(response, raw_token, cookie_age)
                return AuthOut(user=UserOut.model_validate(existing_user), csrf_token=csrf_token_for(raw_token))

    guest = User(
        email=f"guest+{secrets.token_hex(16)}{GUEST_EMAIL_SUFFIX}",
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name="Гость", plan="free", avatar=0, is_guest=True,
    )
    db.add(guest)
    await db.commit()
    await db.refresh(guest)
    token = await _start_session(db, guest, GUEST_SESSION_SECONDS)
    _set_cookies(response, token, GUEST_SESSION_SECONDS)
    return AuthOut(user=UserOut.model_validate(guest), csrf_token=csrf_token_for(token))


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
async def register(
    data: RegisterIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> AuthOut:
    email = data.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid email")

    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    user = User(
        email=email,
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        avatar=random.randrange(AVATAR_COUNT),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await _claim_guest_data(request, db, user)
    token = await _start_session(db, user)
    _set_cookies(response, token)
    return AuthOut(user=UserOut.model_validate(user), csrf_token=csrf_token_for(token))


@router.post("/login", response_model=AuthOut)
async def login(
    data: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> AuthOut:
    email = data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    await _claim_guest_data(request, db, user)
    token = await _start_session(db, user)
    _set_cookies(response, token)
    return AuthOut(user=UserOut.model_validate(user), csrf_token=csrf_token_for(token))


@router.post("/logout")
async def logout(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        result = await db.execute(
            select(Session).where(Session.token_hash == hash_token(token))
        )
        sess = result.scalar_one_or_none()
        if sess is not None:
            await db.delete(sess)
            await db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    response.delete_cookie("chatstudio_csrf", path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/csrf")
async def csrf(request: Request, user: User = Depends(get_current_user)) -> dict:
    token = getattr(request.state, "session_token", None)
    return {"csrf_token": csrf_token_for(token) if token else None}
