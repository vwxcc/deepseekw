"""Per-plan limits (Free / Pro), editable by the administrator."""
from __future__ import annotations

from datetime import datetime, time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Chat, Message, PlanLimit, Role, User, utcnow

GB = 1024 ** 3
MB = 1024 ** 2

# key -> value. ``None`` means "unlimited".
DEFAULTS: dict[str, dict[str, int | None]] = {
    "free": {
        "file_size": 25 * MB,
        "user_storage": 250 * MB,
        "files_count": 50,
        "chats_count": 30,
        "messages_per_day": 100,
        "compress_min": 25,
        "compress_max": 70,
        "compress_per_day": 5,
        "price": 0,
        "cost_per_1k": 0,
        "subscription_days": None,
    },
    "pro": {
        "file_size": 100 * MB,
        "user_storage": 1024 * MB,
        "files_count": 500,
        "chats_count": None,
        "messages_per_day": None,
        "compress_min": 5,
        "compress_max": 85,
        "compress_per_day": None,
        "price": 990,
        "cost_per_1k": 2,
        "subscription_days": 30,
    },
    "max": {
        "file_size": None,
        "user_storage": None,
        "files_count": None,
        "chats_count": None,
        "messages_per_day": None,
        "compress_min": 5,
        "compress_max": 85,
        "compress_per_day": None,
        "price": 0,
        "cost_per_1k": 0,
        "subscription_days": 30,
    },
}

LABELS: dict[str, str] = {
    "file_size": "Размер одного файла",
    "user_storage": "Хранилище на пользователя",
    "files_count": "Файлов всего",
    "chats_count": "Чатов всего",
    "messages_per_day": "Сообщений в день",
    "compress_min": "Сжатие: минимум %",
    "compress_max": "Сжатие: максимум %",
    "compress_per_day": "Сжатий в день",
    "price": "Цена тарифа, ₽/мес",
    "cost_per_1k": "Цена за 1k токенов, ₽",
    "subscription_days": "Срок подписки, дней (пусто = бессрочно)",
}

BYTE_KEYS = {"file_size", "user_storage"}
MONEY_KEYS = {"price", "cost_per_1k"}
TEXT_KEYS = {"models"}

PLANS = ("free", "pro", "max")


def default_limits(plan: str) -> dict[str, int | None]:
    return dict(DEFAULTS.get(plan, DEFAULTS["free"]))


async def effective_plan(db: AsyncSession, user: User) -> str:
    """Normalize expired subscriptions; administrators always get unrestricted limits."""
    if user.is_admin:
        return "max"
    if (
        user.plan not in {"free", "pro", "max"}
        or (
            user.plan != "free"
            and user.subscription_until is not None
            and user.subscription_until <= utcnow()
        )
    ):
        user.plan = "free"
        user.subscription_until = None
        await db.commit()
    return user.plan or "free"


async def get_limits(db: AsyncSession, plan: str) -> dict[str, int | None]:
    """Effective limits: stored overrides merged over the defaults."""
    limits = default_limits(plan)
    rows = (
        await db.execute(select(PlanLimit).where(PlanLimit.plan == plan))
    ).scalars().all()
    for row in rows:
        if row.key in limits:
            limits[row.key] = row.value
    return limits


async def get_models_for_plan(db: AsyncSession, plan: str) -> list[str]:
    """Allowed model-set ids (empty list = все разрешены)."""
    row = (
        await db.execute(
            select(PlanLimit).where(
                PlanLimit.plan == plan, PlanLimit.key == "models"
            )
        )
    ).scalars().first()
    if row is None or not row.text_value:
        return []
    return [x.strip() for x in row.text_value.split(",") if x.strip()]


async def set_models_for_plan(db: AsyncSession, plan: str, ids: list[str]) -> list[str]:
    row = (
        await db.execute(
            select(PlanLimit).where(
                PlanLimit.plan == plan, PlanLimit.key == "models"
            )
        )
    ).scalars().first()
    text = ",".join(dict.fromkeys([i for i in ids if i]))
    if row is None:
        row = PlanLimit(plan=plan, key="models", value=None, text_value=text)
        db.add(row)
    else:
        row.text_value = text
    await db.commit()
    return await get_models_for_plan(db, plan)


async def set_limits(db: AsyncSession, plan: str, values: dict) -> dict[str, int | None]:
    for key, value in values.items():
        if key not in DEFAULTS.get(plan, {}):
            continue
        row = (
            await db.execute(
                select(PlanLimit).where(PlanLimit.plan == plan, PlanLimit.key == key)
            )
        ).scalars().first()
        if row is None:
            row = PlanLimit(plan=plan, key=key, value=value)
            db.add(row)
        else:
            row.value = value
    await db.commit()
    return await get_limits(db, plan)


async def all_limits(db: AsyncSession) -> dict[str, dict[str, int | None]]:
    return {plan: await get_limits(db, plan) for plan in PLANS}


def allow(limits: dict, key: str, current: int, adding: int = 1) -> tuple[bool, str]:
    """Check a numeric limit. Returns (ok, human message)."""
    cap = limits.get(key)
    if cap is None:
        return True, ""
    if current + adding > int(cap):
        return False, f"Лимит тарифа исчерпан: {LABELS.get(key, key)} — {cap}. Обратитесь к администратору ai-ch."
    return True, ""


async def check_message_quota(db: AsyncSession, user: User) -> None:
    """Reject paid AI work when the account has exhausted its daily request quota."""
    if user.is_admin:
        return
    plan = await effective_plan(db, user)
    limits = await get_limits(db, plan)
    cap = limits.get("messages_per_day")
    if cap is None:
        return

    now = utcnow()
    window_start = datetime.combine(now.date(), time.min)
    if user.usage_reset_at is not None and user.usage_reset_at > window_start:
        window_start = user.usage_reset_at

    used = await db.scalar(
        select(func.count())
        .select_from(Message)
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            Chat.user_id == user.id,
            Message.role == Role.assistant,
            Message.created_at >= window_start,
        )
    )
    if int(used or 0) >= int(cap):
        from fastapi import HTTPException, status

        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Дневной лимит запросов исчерпан. Обратитесь к администратору ai-ch для сброса счётчика или выдачи подписки.",
        )
