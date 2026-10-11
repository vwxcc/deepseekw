"""Seed default data on startup (admin user + default model sets)."""
from __future__ import annotations

import logging
import secrets

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import SessionLocal
from .models import ModelSet, ModelSetEntry, RouteType, Session, User, utcnow
from .security import hash_password
from .services.memory_cleanup import clean_noisy_memories

log = logging.getLogger("ai-ch.bootstrap")


async def bootstrap() -> None:
    async with SessionLocal() as db:
        await _seed_admin(db)
        await _seed_model_sets(db)
        await _purge_expired_sessions(db)
        await clean_noisy_memories(db)
        await db.commit()


async def _purge_expired_sessions(db: AsyncSession) -> None:
    await db.execute(delete(Session).where(Session.expires_at < utcnow()))


async def _seed_admin(db: AsyncSession) -> None:
    """Ensure there is an administrator without promoting an arbitrary account."""
    admin_exists = await db.scalar(select(User.id).where(User.is_admin.is_(True)).limit(1))
    if admin_exists:
        return

    email = (settings.admin_email or "admin@ai-ch.local").strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    existing = result.scalar_one_or_none()
    if existing is not None:
        if settings.admin_password:
            # An explicitly configured password is an intentional operator action.
            existing.password_hash = hash_password(settings.admin_password)
            existing.name = existing.name or "Admin"
            existing.plan = "max"
            existing.is_admin = True
            return
        # Do not promote a pre-existing account just because it owns the default email.
        email = f"admin-{secrets.token_hex(4)}@ai-ch.local"

    password = settings.admin_password or secrets.token_urlsafe(24)
    db.add(
        User(
            email=email,
            password_hash=hash_password(password),
            name="Admin",
            plan="max",
            is_admin=True,
        )
    )
    await db.flush()
    if not settings.admin_password:
        log.warning(
            "Первичный администратор создан: email=%s, одноразовый пароль=%s. "
            "Задайте ADMIN_EMAIL и ADMIN_PASSWORD в Render после входа.",
            email,
            password,
        )


async def _seed_model_sets(db: AsyncSession) -> None:
    # Remove the legacy automatic router: task chains are now configured explicitly.
    legacy = await db.execute(select(ModelSet).where(ModelSet.slug == "auto-router"))
    old_router = legacy.scalar_one_or_none()
    if old_router is not None:
        await db.delete(old_router)
        await db.flush()

    defaults = {
        RouteType.MAIN: ("Qwen Main", "qwen-main"),
        RouteType.TITLE: ("Qwen Title", "qwen-title"),
        RouteType.CONTINUE: ("Qwen Continue", "qwen-continue"),
        RouteType.SUGGESTIONS: ("Qwen Suggestions", "qwen-suggestions"),
    }
    for route, (name, slug) in defaults.items():
        result = await db.execute(select(ModelSet).where(ModelSet.slug == slug))
        ms = result.scalar_one_or_none()
        if ms is None:
            ms = ModelSet(name=name, slug=slug, route_type=route, is_active=True)
            db.add(ms)
            await db.flush()
            db.add(
                ModelSetEntry(
                    model_set_id=ms.id,
                    position=0,
                    provider="openai",
                    base_url=settings.qwen_base_url,
                    api_key=settings.qwen_api_key,
                    model=settings.qwen_model,
                    temperature=settings.qwen_temperature,
                    max_tokens=settings.qwen_max_tokens,
                    timeout=settings.request_timeout,
                    is_active=True,
                )
            )
