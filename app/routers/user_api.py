"""Per-user API keys, token wallet analytics and key-level limits."""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import ApiGatewayConfig, UsageEvent, User, UserApiKey, utcnow

router = APIRouter(prefix="/api/my-api", tags=["personal API"])


def _key_public(key: UserApiKey) -> dict[str, Any]:
    return {
        "id": key.id, "name": key.name, "prefix": key.key_prefix,
        "token_limit": int(key.token_limit) if key.token_limit is not None else None,
        "tokens_used": int(key.tokens_used or 0),
        "tokens_reserved": int(key.tokens_reserved or 0),
        "max_output_tokens": int(key.max_output_tokens or 2048),
        "is_active": bool(key.is_active),
        "expires_at": key.expires_at.isoformat() if key.expires_at else None,
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
        "created_at": key.created_at.isoformat() if key.created_at else None,
    }


@router.get("/overview")
async def personal_api_overview(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Return only this account's wallet, key list and API usage."""
    now = utcnow()
    since = now - timedelta(days=13)
    totals = (await db.execute(
        select(
            func.count(UsageEvent.id),
            func.coalesce(func.sum(UsageEvent.tokens_in), 0),
            func.coalesce(func.sum(UsageEvent.tokens_out), 0),
            func.coalesce(func.sum(UsageEvent.tokens_cached), 0),
            func.coalesce(func.sum(UsageEvent.cost_usd), 0.0),
        ).where(UsageEvent.user_id == user.id, UsageEvent.action == "api_v1")
    )).one()
    daily_rows = (await db.execute(
        select(
            func.date(UsageEvent.created_at).label("day"),
            func.coalesce(func.sum(UsageEvent.tokens_in), 0).label("tin"),
            func.coalesce(func.sum(UsageEvent.tokens_out), 0).label("tout"),
            func.coalesce(func.sum(UsageEvent.cost_usd), 0.0).label("cost"),
            func.count(UsageEvent.id).label("calls"),
        ).where(
            UsageEvent.user_id == user.id, UsageEvent.action == "api_v1",
            UsageEvent.created_at >= since,
        ).group_by(func.date(UsageEvent.created_at)).order_by(func.date(UsageEvent.created_at))
    )).all()
    daily_map = {
        str(row.day): {
            "input": int(row.tin or 0), "output": int(row.tout or 0),
            "cost": round(float(row.cost or 0), 8), "calls": int(row.calls or 0),
        } for row in daily_rows
    }
    chart = []
    for offset in range(13, -1, -1):
        day = (now - timedelta(days=offset)).date().isoformat()
        chart.append({"day": day, **daily_map.get(day, {
            "input": 0, "output": 0, "cost": 0.0, "calls": 0,
        })})
    recent_events = (await db.execute(
        select(UsageEvent).where(
            UsageEvent.user_id == user.id, UsageEvent.action == "api_v1"
        ).order_by(UsageEvent.created_at.desc()).limit(30)
    )).scalars().all()
    keys = (await db.execute(
        select(UserApiKey).where(UserApiKey.user_id == user.id)
        .order_by(UserApiKey.created_at.desc())
    )).scalars().all()
    config = await db.get(ApiGatewayConfig, 1)
    return {
        "can_create_keys": not bool(user.is_guest),
        "balance_tokens": max(0, int(user.token_balance or 0)),
        "api_enabled": bool(config and config.enabled),
        "totals": {
            "calls": int(totals[0] or 0), "tokens_in": int(totals[1] or 0),
            "tokens_out": int(totals[2] or 0), "tokens_cached": int(totals[3] or 0),
            "tokens_total": int(totals[1] or 0) + int(totals[2] or 0),
            "cost_usd": round(float(totals[4] or 0), 8),
        },
        "chart": chart, "keys": [_key_public(key) for key in keys],
        "recent": [{
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "model": "ai-ch", "tokens_in": int(item.tokens_in or 0),
            "tokens_out": int(item.tokens_out or 0), "tokens_cached": int(item.tokens_cached or 0),
            "tokens_total": int(item.tokens_in or 0) + int(item.tokens_out or 0),
            "cost_usd": round(float(item.cost_usd or 0), 8),
            "key_prefix": next((key.key_prefix for key in keys if key.id == item.api_key_id), ""),
        } for item in recent_events],
    }


@router.post("/keys", status_code=status.HTTP_201_CREATED)
async def create_personal_api_key(
    data: dict, user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db),
) -> dict:
    if user.is_guest:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Сначала зарегистрируйте аккаунт, чтобы создавать API-ключи")
    count = await db.scalar(select(func.count()).select_from(UserApiKey).where(UserApiKey.user_id == user.id))
    if int(count or 0) >= 20:
        raise HTTPException(status.HTTP_409_CONFLICT, "Можно создать не более 20 API-ключей")
    body = data if isinstance(data, dict) else {}
    name = str(body.get("name") or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Название ключа должно содержать 1–80 символов")
    try:
        raw_limit = body.get("token_limit")
        token_limit = None if raw_limit in (None, "") else int(raw_limit)
        max_output = int(body.get("max_output_tokens", 2048))
        expires_days = int(body.get("expires_days", 0) or 0)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Проверьте числовые настройки ключа")
    if token_limit is not None and not 1 <= token_limit <= 1_000_000_000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Лимит ключа: от 1 до 1 000 000 000 токенов")
    if not 1 <= max_output <= 32768:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Лимит ответа: от 1 до 32 768 токенов")
    if expires_days not in range(0, 3651):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Срок действия: 1–3650 дней или 0 для бессрочного")
    secret = "aich_" + secrets.token_urlsafe(32)
    key = UserApiKey(
        user_id=user.id, name=name,
        key_hash=hashlib.sha256(secret.encode("utf-8")).hexdigest(),
        key_prefix=secret[:15], token_limit=token_limit,
        max_output_tokens=max_output,
        expires_at=(utcnow() + timedelta(days=expires_days)) if expires_days else None,
        is_active=True,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return {"api_key": secret, "key": _key_public(key)}


@router.patch("/keys/{key_id}")
async def update_personal_api_key(
    key_id: str, data: dict, user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db),
) -> dict:
    key = (await db.execute(
        select(UserApiKey).where(UserApiKey.id == key_id, UserApiKey.user_id == user.id)
    )).scalar_one_or_none()
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API-ключ не найден")
    body = data if isinstance(data, dict) else {}
    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name or len(name) > 80:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Название должно содержать 1–80 символов")
        key.name = name
    if "token_limit" in body:
        raw = body.get("token_limit")
        try:
            new_limit = None if raw in (None, "") else int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Лимит должен быть целым числом")
        used = int(key.tokens_used or 0) + int(key.tokens_reserved or 0)
        if new_limit is not None and not used <= new_limit <= 1_000_000_000:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Новый лимит не может быть меньше уже использованных токенов; максимум 1 млрд")
        key.token_limit = new_limit
    if "max_output_tokens" in body:
        try:
            new_output = int(body["max_output_tokens"])
        except (TypeError, ValueError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Лимит ответа должен быть целым числом")
        if not 1 <= new_output <= 32768:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Лимит ответа: от 1 до 32 768 токенов")
        key.max_output_tokens = new_output
    if "expires_days" in body:
        try:
            expires_days = int(body["expires_days"] or 0)
        except (TypeError, ValueError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Срок действия должен быть числом дней")
        if expires_days not in range(0, 3651):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Срок действия: 1–3650 дней или 0 для бессрочного")
        key.expires_at = (utcnow() + timedelta(days=expires_days)) if expires_days else None
    if "is_active" in body:
        if not isinstance(body["is_active"], bool):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "is_active должен быть логическим значением")
        key.is_active = body["is_active"]
    await db.commit()
    await db.refresh(key)
    return {"ok": True, "key": _key_public(key)}


@router.delete("/keys/{key_id}")
async def revoke_personal_api_key(
    key_id: str, user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db),
) -> dict:
    key = (await db.execute(
        select(UserApiKey).where(UserApiKey.id == key_id, UserApiKey.user_id == user.id)
    )).scalar_one_or_none()
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API-ключ не найден")
    key.is_active = False
    await db.commit()
    return {"ok": True, "id": key.id, "is_active": False}
