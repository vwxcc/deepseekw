"""ModelSet resolution helpers."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ModelSet, ModelSetEntry, RouteType


async def get_model_set(db: AsyncSession, route_type: RouteType) -> ModelSet | None:
    result = await db.execute(
        select(ModelSet).where(
            ModelSet.route_type == route_type, ModelSet.is_active.is_(True)
        )
    )
    return result.scalars().first()


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
