"""User memory: what the assistant remembers about the user."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import Memory, User, UserPreference
from ..schemas import MemoryIn, MemoryOut

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("", response_model=list[MemoryOut])
async def list_memory(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Memory)
        .where(Memory.user_id == user.id)
        .order_by(Memory.created_at.desc())
    )
    return [MemoryOut.model_validate(m) for m in result.scalars().all()]


@router.get("/settings")
async def get_memory_settings(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Memory is on by default until a user explicitly turns it off."""
    setting = await db.get(UserPreference, user.id)
    return {
        "memory_enabled": bool(setting.memory_enabled) if setting is not None else True,
        "accent_color": str(setting.accent_color or "#3b82f6") if setting is not None else "#3b82f6",
    }


@router.put("/settings")
async def update_memory_settings(
    data: dict,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    body = data if isinstance(data, dict) else {}
    enabled = body.get("memory_enabled")
    accent_color = body.get("accent_color")
    if enabled is not None and not isinstance(enabled, bool):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "memory_enabled должен быть true или false")
    if accent_color is not None:
        if not isinstance(accent_color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", accent_color.strip()):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "accent_color должен быть HEX-цветом формата #RRGGBB",
            )
        accent_color = accent_color.strip().lower()
    if enabled is None and accent_color is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Не переданы настройки для сохранения")

    setting = await db.get(UserPreference, user.id)
    if setting is None:
        setting = UserPreference(
            user_id=user.id,
            memory_enabled=True if enabled is None else enabled,
            accent_color=accent_color or "#3b82f6",
        )
        db.add(setting)
    else:
        if enabled is not None:
            setting.memory_enabled = enabled
        if accent_color is not None:
            setting.accent_color = accent_color
    await db.commit()
    return {
        "memory_enabled": bool(setting.memory_enabled),
        "accent_color": str(setting.accent_color or "#3b82f6"),
    }


@router.post("", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
async def add_memory(
    data: MemoryIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустая заметка")
    kind = (data.kind or "fact").strip().lower()
    if kind not in ("fact", "preference"):
        kind = "fact"
    rec = Memory(user_id=user.id, content=content[:2000], kind=kind)
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return MemoryOut.model_validate(rec)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(Memory, memory_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заметка не найдена")
    await db.delete(rec)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_memory(
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Memory).where(Memory.user_id == user.id))
    for rec in result.scalars().all():
        await db.delete(rec)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
