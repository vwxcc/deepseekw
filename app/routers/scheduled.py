"""Private calendar items written by the user or by an explicit AI scheduling marker."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import ScheduledItem, User
from ..schemas import ScheduledItemIn, ScheduledItemOut, ScheduledItemUpdate

router = APIRouter(prefix="/api/scheduled", tags=["scheduled"])


def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    # Browser requests should include a UTC offset. A naive value is treated as UTC.
    return value.replace(tzinfo=timezone.utc).replace(tzinfo=None)


def _out(item: ScheduledItem) -> ScheduledItemOut:
    result = ScheduledItemOut.model_validate(item)
    value = item.due_at
    result.due_at = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return result


@router.get("", response_model=list[ScheduledItemOut])
async def list_scheduled(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledItem)
        .where(ScheduledItem.user_id == user.id)
        .order_by(ScheduledItem.due_at.asc(), ScheduledItem.created_at.desc())
    )
    return [_out(item) for item in result.scalars().all()]


@router.post("", response_model=ScheduledItemOut, status_code=status.HTTP_201_CREATED)
async def create_scheduled(
    data: ScheduledItemIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название события")
    result = await db.execute(
        select(ScheduledItem.id).where(ScheduledItem.user_id == user.id)
    )
    if len(result.all()) >= 500:
        raise HTTPException(status.HTTP_409_CONFLICT, "В календаре не может быть больше 500 записей")
    item = ScheduledItem(
        user_id=user.id,
        title=title,
        description=(data.description or "").strip(),
        due_at=_utc_naive(data.due_at),
        created_by="user",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _out(item)


@router.patch("/{item_id}", response_model=ScheduledItemOut)
async def update_scheduled(
    item_id: str,
    data: ScheduledItemUpdate,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(ScheduledItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запись календаря не найдена")
    if "title" in data.model_fields_set:
        title = (data.title or "").strip()
        if not title:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название события")
        item.title = title
    if "description" in data.model_fields_set:
        item.description = (data.description or "").strip()
    if data.due_at is not None:
        item.due_at = _utc_naive(data.due_at)
    await db.commit()
    await db.refresh(item)
    return _out(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scheduled(
    item_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(ScheduledItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запись календаря не найдена")
    await db.delete(item)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
