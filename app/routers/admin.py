"""Admin API: Model Sets and their model entries."""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..deps import get_current_admin, get_db, require_csrf
from ..models import ModelSet, ModelSetEntry, RouteType
from ..schemas import (
    ModelSetCreate,
    ModelSetEntryIn,
    ModelSetEntryOut,
    ModelSetEntryUpdate,
    ModelSetOut,
    ModelSetUpdate,
)
from ..services.model_sets_view import entry_out, model_set_out

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    if not s:
        # non-latin names (e.g. Cyrillic) would collapse to "" -> use unique suffix
        s = "set-" + uuid.uuid4().hex[:8]
    return s


async def _get_set(db: AsyncSession, set_id: str) -> ModelSet:
    result = await db.execute(
        select(ModelSet)
        .options(selectinload(ModelSet.entries))
        .where(ModelSet.id == set_id)
    )
    ms = result.scalar_one_or_none()
    if ms is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model Set не найден")
    return ms


@router.get("/model-sets", response_model=list[ModelSetOut])
async def list_model_sets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ModelSet)
        .options(selectinload(ModelSet.entries))
        .order_by(ModelSet.route_type, ModelSet.name)
    )
    return [model_set_out(ms) for ms in result.scalars().all()]


@router.post("/model-sets", response_model=ModelSetOut, status_code=status.HTTP_201_CREATED)
async def create_model_set(
    data: ModelSetCreate, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)
):
    try:
        route = RouteType(data.route_type.upper())
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "route_type: MAIN / TITLE / SUGGESTIONS"
        )
    slug = (data.slug or _slugify(data.name)).strip()
    exists = await db.execute(select(ModelSet).where(ModelSet.slug == slug))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Такой slug уже существует")
    ms = ModelSet(
        name=(data.name or "").strip() or "Model Set",
        slug=slug,
        route_type=route,
        is_active=data.is_active,
    )
    db.add(ms)
    await db.commit()
    return model_set_out(await _get_set(db, ms.id))


@router.patch("/model-sets/{set_id}", response_model=ModelSetOut)
async def update_model_set(
    set_id: str,
    data: ModelSetUpdate,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    ms = await _get_set(db, set_id)
    if data.name is not None and data.name.strip():
        ms.name = data.name.strip()
    if data.is_active is not None:
        ms.is_active = data.is_active
    await db.commit()
    return model_set_out(await _get_set(db, set_id))


@router.delete("/model-sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model_set(
    set_id: str, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)
):
    ms = await _get_set(db, set_id)
    await db.delete(ms)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/model-sets/{set_id}/entries",
    response_model=ModelSetEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_entry(
    set_id: str,
    data: ModelSetEntryIn,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    await _get_set(db, set_id)
    e = ModelSetEntry(
        model_set_id=set_id,
        provider=data.provider,
        base_url=data.base_url,
        api_key=data.api_key,
        model=data.model,
        position=data.position,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        timeout=data.timeout,
        is_active=data.is_active,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return entry_out(e)


@router.patch(
    "/model-sets/{set_id}/entries/{entry_id}", response_model=ModelSetEntryOut
)
async def update_entry(
    set_id: str,
    entry_id: str,
    data: ModelSetEntryUpdate,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    e = await db.get(ModelSetEntry, entry_id)
    if e is None or e.model_set_id != set_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Модель не найдена")
    for field in (
        "provider",
        "base_url",
        "model",
        "position",
        "temperature",
        "max_tokens",
        "timeout",
        "is_active",
    ):
        value = getattr(data, field)
        if value is not None:
            setattr(e, field, value)
    if data.api_key:  # пустая строка = оставить прежний ключ
        e.api_key = data.api_key
    await db.commit()
    await db.refresh(e)
    return entry_out(e)


@router.delete(
    "/model-sets/{set_id}/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_entry(
    set_id: str,
    entry_id: str,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    e = await db.get(ModelSetEntry, entry_id)
    if e is None or e.model_set_id != set_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Модель не найдена")
    await db.delete(e)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
