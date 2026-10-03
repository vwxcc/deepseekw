"""Model set listing available to any authenticated user."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..deps import get_current_user, get_db
from ..models import ModelSet, User
from ..schemas import ModelSetOut
from ..services.model_sets_view import model_set_out

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/sets", response_model=list[ModelSetOut])
async def list_sets(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ModelSet)
        .options(selectinload(ModelSet.entries))
        .where(ModelSet.is_active.is_(True))
        .order_by(ModelSet.route_type, ModelSet.name)
    )
    return [model_set_out(ms) for ms in result.scalars().all()]
