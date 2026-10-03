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
    },
    "pro": {
        "file_size": 100 * MB,
        "user_storage": 4 * GB,
        "files_count": 500,
        "posts": 50,
        "code_agents": 20,
        "agent_steps": 10,
        "council_members": 4,
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
}

BYTE_KEYS = {"file_size", "user_storage"}

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
