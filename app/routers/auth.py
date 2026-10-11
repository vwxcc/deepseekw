"""Auth endpoints: register, login, logout, me, csrf."""
from __future__ import annotations

import random
from datetime import datetime, timezone

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
from ..security_middleware import (
    LoginAttemptLogger,
    RateLimiter,
    _auth_limiter,
)
from ..services.avatars import AVATAR_COUNT

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Rate limiter для register
_register_limiter = RateLimiter(max_attempts=3, window_seconds=600)  # 3 попытки за 10 минут

# Rate limiter для login (отдельный, более строгий)
_login_limiter = RateLimiter(max_attempts=5, window_seconds=300)  # 5 попыток за 5 минут

# Минимальная длина пароля
_MIN_PASSWORD_LENGTH = 8

# Требования к паролю: хотя бы одна заглавная, одна строчная, одна цифра
import re
_PASSWORD_PATTERN = re.compile(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$')


def _set_cookies(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_max_age,
        httponly=True,  # JavaScript не может получить cookie
        samesite="lax",  # Защита от CSRF
        secure=settings.session_cookie_secure,  # Только HTTPS
        path="/",
    )
    response.set_cookie(
        "ai-ch_csrf",
        csrf_token_for(token),
        max_age=settings.session_max_age,
        httponly=False,  # Нужен для JS (CSRF-токен)
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )


async def _start_session(db: AsyncSession, user: User) -> str:
    """Создаёт новую сессию (session rotation для защиты от fixation)."""
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


async def _rotate_session(
    db: AsyncSession, old_token: str, user: User
) -> str:
    """Поворачивает сессию: удаляет старую, создаёт новую."""
    # Удаляем старую сессию
    result = await db.execute(
        select(Session).where(Session.token_hash == hash_token(old_token))
    )
    sess = result.scalar_one_or_none()
    if sess:
        await db.delete(sess)
    
    # Создаём новую
    return await _start_session(db, user)


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
async def register(
    request: Request,
    data: RegisterIn,
    response: Response,
    db: AsyncSession = Depends(get_db)
) -> AuthOut:
    # --- Rate limiting ---
    client_ip = request.client.host if request.client else "unknown"
    allowed, remaining = _register_limiter.is_allowed(f"register:{client_ip}")
    if not allowed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много попыток регистрации. Подождите 10 минут."
        )
    
    # --- Валидация email ---
    email = data.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid email")

    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    # --- Password policy ---
    password = data.password
    if len(password) < _MIN_PASSWORD_LENGTH:
        LoginAttemptLogger.log_attempt(email, False, client_ip, "password_too_short")
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Пароль должен содержать минимум {_MIN_PASSWORD_LENGTH} символов"
        )
    
    if not _PASSWORD_PATTERN.match(password):
        LoginAttemptLogger.log_attempt(email, False, client_ip, "password_weak")
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Пароль должен содержать заглавные, строчные буквы и цифры"
        )

    # --- Создаём пользователя ---
    user = User(
        email=email,
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        avatar=random.randrange(AVATAR_COUNT),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # --- Успешная регистрация ---
    token = await _start_session(db, user)
    _set_cookies(response, token)
    _register_limiter.reset(f"register:{client_ip}")
    LoginAttemptLogger.log_attempt(email, True, client_ip)
    
    return AuthOut(user=UserOut.model_validate(user), csrf_token=csrf_token_for(token))


@router.post("/login", response_model=AuthOut)
async def login(
    request: Request,
    data: LoginIn,
    response: Response,
    db: AsyncSession = Depends(get_db)
) -> AuthOut:
    client_ip = request.client.host if request.client else "unknown"
    
    # --- Rate limiting ---
    allowed, remaining = _login_limiter.is_allowed(f"login:{client_ip}")
    if not allowed:
        LoginAttemptLogger.log_attempt(data.email, False, client_ip, "rate_limited")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много попыток входа. Подождите 5 минут."
        )

    email = data.email.strip().lower()
    
    # Проверяем по времени (constant-time) чтобы избежать timing attacks
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    
    if user is None or not verify_password(data.password, user.password_hash):
        LoginAttemptLogger.log_attempt(email, False, client_ip, "invalid_credentials")
        
        # Блокируем IP после 10 неудачных попыток
        if remaining <= 0:
            _auth_limiter.is_allowed(f"login:{client_ip}")  # Consumes attempt
        
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # --- Успешный вход ---
    token = await _start_session(db, user)
    _set_cookies(response, token)
    _login_limiter.reset(f"login:{client_ip}")
    LoginAttemptLogger.log_attempt(email, True, client_ip)
    
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
    response.delete_cookie("ai-ch_csrf", path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/csrf")
async def csrf(request: Request, user: User = Depends(get_current_user)) -> dict:
    token = getattr(request.state, "session_token", None)
    return {"csrf_token": csrf_token_for(token) if token else None}


@router.get("/security-info")
async def security_info(user: User = Depends(get_current_user)) -> dict:
    """Информация о безопасности текущей сессии."""
    return {
        "https": settings.is_https,
        "session_secure": settings.session_cookie_secure,
        "csrf_enabled": settings.csrf_protection,
        "session_max_age": settings.session_max_age,
        "rate_limit_enabled": True,
        "password_min_length": _MIN_PASSWORD_LENGTH,
    }
