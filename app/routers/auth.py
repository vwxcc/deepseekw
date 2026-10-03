"""Auth endpoints: register, login, logout, me, csrf."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..deps import COOKIE_NAME, get_current_user, get_db
from ..models import Session, User
from ..schemas import AuthOut, LoginIn, RegisterIn, UserOut
from ..security import (
    csrf_token_for,
    generate_session_token,
    hash_password,
    hash_token,
    session_expiry,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookies(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_max_age,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )
    response.set_cookie(
        "chatstudio_csrf",
        csrf_token_for(token),
        max_age=settings.session_max_age,
        httponly=False,
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )


async def _start_session(db: AsyncSession, user: User) -> str:
    token = generate_session_token()
    db.add(
        Session(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=session_expiry(),
        )
    )
    await db.commit()
    return token


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
async def register(
    data: RegisterIn, response: Response, db: AsyncSession = Depends(get_db)
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
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = await _start_session(db, user)
    _set_cookies(response, token)
    return AuthOut(user=UserOut.model_validate(user), csrf_token=csrf_token_for(token))


@router.post("/login", response_model=AuthOut)
async def login(
    data: LoginIn, response: Response, db: AsyncSession = Depends(get_db)
) -> AuthOut:
    email = data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

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
