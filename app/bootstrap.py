"""Seed default data on startup (admin user + default model sets)."""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import SessionLocal
from .models import ModelSet, ModelSetEntry, RouteType, Session, User, utcnow
from .security import hash_password


async def bootstrap() -> None:
    async with SessionLocal() as db:
        await _seed_admin(db)
        await _seed_model_sets(db)
        await _purge_expired_sessions(db)
        await db.commit()


async def _purge_expired_sessions(db: AsyncSession) -> None:
    await db.execute(delete(Session).where(Session.expires_at < utcnow()))


async def _seed_admin(db: AsyncSession) -> None:
    if not settings.admin_email or not settings.admin_password:
        return
    email = settings.admin_email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none() is None:
        db.add(
            User(
                email=email,
                password_hash=hash_password(settings.admin_password),
                name="Admin",
                plan="max",
                is_admin=True,
            )
        )


async def _seed_model_sets(db: AsyncSession) -> None:
    defaults = {
        RouteType.MAIN: ("Qwen Main", "qwen-main"),
        RouteType.TITLE: ("Qwen Title", "qwen-title"),
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

    # "Auto (Routing)" — the router cluster picks a concrete set per request
    result = await db.execute(select(ModelSet).where(ModelSet.slug == "auto-router"))
    if result.scalar_one_or_none() is None:
        ms = ModelSet(
            name="Auto (Routing)",
            slug="auto-router",
            route_type=RouteType.MAIN,
            is_active=True,
            is_router=True,
        )
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
                temperature=0.0,
                max_tokens=1000,
                timeout=settings.request_timeout,
                is_active=True,
            )
        )
