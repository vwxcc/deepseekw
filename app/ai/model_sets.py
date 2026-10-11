"""ModelSet resolution helpers."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ModelSet, ModelSetEntry, RouteType


async def get_model_set(db: AsyncSession, route_type: RouteType) -> ModelSet | None:
    """Resolve one deterministic fallback chain for a task, never an auto-router."""
    preferred_slug = {
        RouteType.MAIN: "qwen-main",
        RouteType.TITLE: "qwen-title",
        RouteType.CONTINUE: "qwen-continue",
        RouteType.SUGGESTIONS: "qwen-suggestions",
    }.get(route_type)
    result = await db.execute(
        select(ModelSet)
        .where(
            ModelSet.route_type == route_type,
            ModelSet.is_active.is_(True),
            ModelSet.is_router.is_(False),
        )
        .order_by(ModelSet.slug)
    )
    model_sets = list(result.scalars().all())
    if preferred_slug:
        preferred = next((item for item in model_sets if item.slug == preferred_slug), None)
        if preferred is not None:
            return preferred
    return model_sets[0] if model_sets else None


async def get_active_entries(
    db: AsyncSession, model_set_id: str
) -> list[ModelSetEntry]:
    result = await db.execute(
        select(ModelSetEntry)
        .where(
            ModelSetEntry.model_set_id == model_set_id,
            ModelSetEntry.is_active.is_(True),
        )
        .order_by(ModelSetEntry.position)
    )
    return list(result.scalars().all())
