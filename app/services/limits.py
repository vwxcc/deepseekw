"""Per-plan limits (Free / Pro), editable by the administrator."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import PlanLimit

GB = 1024 ** 3
MB = 1024 ** 2

# key -> value. ``None`` means "unlimited".
DEFAULTS: dict[str, dict[str, int | None]] = {
    "free": {
        "file_size": 25 * MB,
        "user_storage": 512 * MB,
        "files_count": 50,
        "posts": 3,
        "code_agents": 1,
        "agent_steps": 6,
        "council_members": 2,
        "chats_count": 30,
        "messages_per_day": 100,
        "sandbox_seconds": 40,
        "compress_min": 25,
        "compress_max": 70,
        "compress_per_day": 5,
        "price": 0,
        "cost_per_1k": 0,
    },
    "pro": {
        "file_size": 100 * MB,
        "user_storage": 4 * GB,
        "files_count": 500,
        "posts": 50,
        "code_agents": 20,
        "agent_steps": 10,
        "council_members": 4,
        "chats_count": None,
        "messages_per_day": None,
        "sandbox_seconds": 120,
        "compress_min": 5,
        "compress_max": 85,
        "compress_per_day": None,
        "price": 19,
        "cost_per_1k": 2,
    },
}

LABELS: dict[str, str] = {
    "file_size": "Размер одного файла",
    "user_storage": "Хранилище на пользователя",
    "files_count": "Файлов всего",
    "posts": "Постов на стенке",
    "code_agents": "Код-агентов",
    "agent_steps": "Шагов агента",
    "council_members": "Участников консилиума",
    "chats_count": "Чатов всего",
    "messages_per_day": "Сообщений в день",
    "sandbox_seconds": "Секунд на запуск кода",
    "compress_min": "Сжатие: минимум %",
    "compress_max": "Сжатие: максимум %",
    "compress_per_day": "Сжатий в день",
    "price": "Цена тарифа, $/мес",
    "cost_per_1k": "Цена за 1k токенов, $",
}

BYTE_KEYS = {"file_size", "user_storage"}
MONEY_KEYS = {"price", "cost_per_1k"}
TEXT_KEYS = {"models"}

PLANS = ("free", "pro")


def default_limits(plan: str) -> dict[str, int | None]:
    return dict(DEFAULTS.get(plan, DEFAULTS["free"]))


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
        return False, f"Лимит тарифа исчерпан: {LABELS.get(key, key)} — {cap}"
    return True, ""
