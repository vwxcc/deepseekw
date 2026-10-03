"""Model set listing + public analytics, available to any authenticated user."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..deps import get_current_user, get_db
from ..models import Message, ModelSet, ModelSetEntry, Role, User
from ..schemas import ModelSetOut, ModelStatOut
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


@router.get("/stats", response_model=list[ModelStatOut])
async def model_stats(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Everything the UI shows on the "Модели и статус" page."""
    sets = (
        await db.execute(
            select(ModelSet)
            .options(selectinload(ModelSet.entries))
            .order_by(ModelSet.route_type, ModelSet.name)
        )
    ).scalars().all()

    total = await db.scalar(
        select(func.count()).select_from(Message).where(Message.role == Role.assistant)
    )
    total = total or 0

    out: list[ModelStatOut] = []
    for ms in sets:
        entries = list(ms.entries or [])
        cnt = (
            await db.scalar(
                select(func.count())
                .select_from(Message)
                .where(Message.model_set_id == ms.id)
            )
            or 0
        )
        tin = (
            await db.scalar(
                select(func.coalesce(func.sum(Message.tokens_in), 0)).where(
                    Message.model_set_id == ms.id
                )
            )
            or 0
        )
        tout = (
            await db.scalar(
                select(func.coalesce(func.sum(Message.tokens_out), 0)).where(
                    Message.model_set_id == ms.id
                )
            )
            or 0
        )
        cached = (
            await db.scalar(
                select(func.coalesce(func.sum(Message.tokens_cached), 0)).where(
                    Message.model_set_id == ms.id
                )
            )
            or 0
        )
        up = (
            await db.scalar(
                select(func.count())
                .select_from(Message)
                .where(Message.model_set_id == ms.id, Message.rating > 0)
            )
            or 0
        )
        down = (
            await db.scalar(
                select(func.count())
                .select_from(Message)
                .where(Message.model_set_id == ms.id, Message.rating < 0)
            )
            or 0
        )
        primary = entries[0] if entries else None
        route = ms.route_type.value if hasattr(ms.route_type, "value") else str(ms.route_type)
        out.append(
            ModelStatOut(
                id=ms.id,
                name=ms.name,
                model=primary.model if primary else "",
                route_type=route,
                entries=len(entries),
                active_entries=sum(1 for e in entries if e.is_active),
                messages=cnt,
                tokens_in=int(tin),
                tokens_out=int(tout),
                tokens_cached=int(cached),
                rating_up=up,
                rating_down=down,
                share=round(cnt / total * 100, 1) if total else 0.0,
            )
        )
    out.sort(key=lambda s: s.messages, reverse=True)
    return out
