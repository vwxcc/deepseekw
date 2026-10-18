"""Seed default data on startup (admin user + default model sets)."""
from __future__ import annotations

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import SessionLocal
from .models import ModelSet, ModelSetEntry, PlanLimit, RouteType, Session, User, utcnow
from .security import hash_password
from .services.memory_cleanup import clean_noisy_memories


async def bootstrap() -> None:
    async with SessionLocal() as db:
        await _seed_admin(db)
        await _seed_model_sets(db)
        await _ensure_primary_main_prices(db)
        await _ensure_pro_budget(db)
        await _purge_expired_sessions(db)
        await clean_noisy_memories(db)
        await db.commit()


async def _ensure_primary_main_prices(db: AsyncSession) -> None:
    """Set initial rates for the primary MAIN model once, without resetting admin edits."""
    await db.execute(text(
        "CREATE TABLE IF NOT EXISTS app_metadata "
        "(key VARCHAR(100) PRIMARY KEY, value VARCHAR(255) NOT NULL)"
    ))
    marker = await db.scalar(text(
        "SELECT value FROM app_metadata WHERE key = 'main-price-defaults-v3'"
    ))
    if marker:
        return
    sets = await db.execute(
        select(ModelSet).where(
            ModelSet.route_type == RouteType.MAIN,
            ModelSet.is_active.is_(True),
            ModelSet.is_router.is_(False),
        ).order_by(ModelSet.name, ModelSet.id)
    )
    for model_set in sets.scalars().all():
        rows = await db.execute(
            select(ModelSetEntry).where(
                ModelSetEntry.model_set_id == model_set.id,
                ModelSetEntry.is_active.is_(True),
            ).order_by(ModelSetEntry.position, ModelSetEntry.id)
        )
        entry = rows.scalars().first()
        if entry is None:
            continue
        default_in = 2.0
        default_out = 25.0
        # This versioned one-time migration intentionally updates the existing
        # primary entry too; later starts leave any administrator edits untouched.
        entry.price_in = default_in
        entry.price_out = default_out
        break
    await db.execute(text(
        "INSERT INTO app_metadata (key, value) VALUES ('main-price-defaults-v3', '1')"
    ))


async def _ensure_pro_budget(db: AsyncSession) -> None:
    """Migrate the previous built-in Pro budget of $10 to the requested $15 once."""
    await db.execute(text(
        "CREATE TABLE IF NOT EXISTS app_metadata "
        "(key VARCHAR(100) PRIMARY KEY, value VARCHAR(255) NOT NULL)"
    ))
    marker = await db.scalar(text(
        "SELECT value FROM app_metadata WHERE key = 'pro-budget-default-v2'"
    ))
    if marker:
        return
    row = (await db.execute(
        select(PlanLimit).where(PlanLimit.plan == "pro", PlanLimit.key == "budget_usd")
    )).scalars().first()
    # Only upgrade the old default; preserve a deliberately customized budget.
    if row is not None and row.value is not None and float(row.value) == 10.0:
        row.value = 15.0
    await db.execute(text(
        "INSERT INTO app_metadata (key, value) VALUES ('pro-budget-default-v2', '1')"
    ))


async def _purge_expired_sessions(db: AsyncSession) -> None:
    await db.execute(delete(Session).where(Session.expires_at < utcnow()))


async def _seed_admin(db: AsyncSession) -> None:
    if not settings.admin_email or not settings.admin_password:
        return
    email = settings.admin_email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        db.add(
            User(
                email=email,
                password_hash=hash_password(settings.admin_password),
                name="Admin",
                plan="free",
                is_admin=True,
            )
        )
    elif user.is_admin and str(user.plan or "").strip().lower() == "max":
        # Older startup code implicitly gave the admin Pro limits. Admin rights
        # are independent from a paid subscription; migrate that implicit grant.
        user.plan = "free"


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
                    price_in=(float(settings.qwen_price_in) if settings.qwen_price_in is not None else 2.0) if route == RouteType.MAIN else 0.0,
                    price_out=(float(settings.qwen_price_out) if settings.qwen_price_out is not None else 25.0) if route == RouteType.MAIN else 0.0,
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
