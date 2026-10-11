"""Plan limits: read for everyone, edited by the administrator."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_admin, get_current_user, get_db, require_csrf
from ..models import Chat, File, Message, ModelSet, Role, RouteType, User, utcnow
from ..services.limits import (
    LABELS,
    PLANS,
    all_limits,
    get_limits,
    get_models_for_plan,
    set_limits,
    set_models_for_plan,
    effective_plan,
)

router = APIRouter(prefix="/api/limits", tags=["limits"])


@router.get("")
async def my_limits(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Current plan + limits + live usage counters."""
    plan = await effective_plan(db, user)
    limits = await get_limits(db, plan)
    files = await db.scalar(
        select(func.count()).select_from(File).where(File.user_id == user.id)
    )
    used = await db.scalar(
        select(func.coalesce(func.sum(File.size), 0)).where(File.user_id == user.id)
    )
    reset_filter = [Message.created_at >= user.usage_reset_at] if user.usage_reset_at is not None else []
    spent = await db.scalar(
        select(func.coalesce(func.sum(Message.tokens_in), 0) + func.coalesce(func.sum(Message.tokens_out), 0))
        .select_from(Message).join(Chat, Chat.id == Message.chat_id)
        .where(Chat.user_id == user.id, Message.role == Role.assistant, *reset_filter)
    )
    reqs = await db.scalar(
        select(func.count()).select_from(Message).join(Chat, Chat.id == Message.chat_id)
        .where(Chat.user_id == user.id, Message.role == Role.assistant, or_(user.usage_reset_at.is_(None), Message.created_at >= user.usage_reset_at))
    )
    today_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if user.usage_reset_at is not None and user.usage_reset_at > today_start:
        today_start = user.usage_reset_at
    today_requests = await db.scalar(
        select(func.count()).select_from(Message).join(Chat, Chat.id == Message.chat_id)
        .where(Chat.user_id == user.id, Message.role == Role.assistant, Message.created_at >= today_start)
    )
    return {
        "plan": plan,
        "labels": LABELS,
        "limits": limits,
        "usage": {
            "files": files or 0,
            "storage": int(used or 0),
            "tokens": int(spent or 0),
            "requests": int(reqs or 0),
            "messages_today": int(today_requests or 0),
            "messages_daily_limit": limits.get("messages_per_day"),
            "subscription_until": user.subscription_until.isoformat() if user.subscription_until else None,
        },
    }


@router.get("/all")
async def limits_all(
    admin: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> dict:
    models = (
        await db.execute(
            select(ModelSet).where(ModelSet.route_type == RouteType.MAIN, ModelSet.is_router.is_(False)).order_by(ModelSet.name)
        )
    ).scalars().all()
    return {
        "plans": list(PLANS),
        "labels": LABELS,
        "limits": await all_limits(db),
        "models": [{"id": m.id, "name": m.name} for m in models],
        "allowed": {
            plan: await get_models_for_plan(db, plan) for plan in PLANS
        },
    }


@router.put("/{plan}/models")
async def limits_models(
    plan: str,
    data: dict,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    ids = list((data or {}).get("ids") or [])
    return {"plan": plan, "allowed": await set_models_for_plan(db, plan, ids)}


@router.get("/users")
async def users_overview(
    admin: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """Every user with plan, live usage and money."""
    spend = (
        select(
            Chat.user_id.label("uid"),
            func.count(Message.id).label("requests"),
            func.coalesce(func.sum(Message.tokens_in), 0).label("tin"),
            func.coalesce(func.sum(Message.tokens_out), 0).label("tout"),
        )
        .join(Message, Message.chat_id == Chat.id)
        .join(User, User.id == Chat.user_id)
        .where(Message.role == Role.assistant, or_(User.usage_reset_at.is_(None), Message.created_at >= User.usage_reset_at))
        .group_by(Chat.user_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                User,
                func.coalesce(spend.c.requests, 0),
                func.coalesce(spend.c.tin, 0),
                func.coalesce(spend.c.tout, 0),
            ).outerjoin(spend, spend.c.uid == User.id).order_by(User.created_at)
        )
    ).all()

    out: list[dict] = []
    for user, requests, tin, tout in rows:
        plan = await effective_plan(db, user)
        limits = await get_limits(db, plan)
        rate = float(limits.get("cost_per_1k") or 0)
        tokens = int(tin) + int(tout)
        used = await db.scalar(
            select(func.coalesce(func.sum(File.size), 0)).where(File.user_id == user.id)
        )
        out.append(
            {
                "id": user.id,
                "email": user.email,
                "name": user.name or "",
                "plan": plan,
                "is_admin": bool(user.is_admin),
                "avatar": user.avatar or 0,
                "requests": int(requests or 0),
                "tokens_in": int(tin or 0),
                "tokens_out": int(tout or 0),
                "storage": int(used or 0),
                "plan_price": int(limits.get("price") or 0),
                "cost": round(tokens / 1000 * rate, 2),
                "subscription_until": user.subscription_until.isoformat() if user.subscription_until else None,
                "usage_reset_at": user.usage_reset_at.isoformat() if user.usage_reset_at else None,
            }
        )
    return out


@router.put("/{plan}")
async def limits_update(
    plan: str,
    data: dict,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if plan not in PLANS:
        plan = "free"
    values: dict[str, int] = {}
    for key, raw in (data or {}).items():
        try:
            values[key] = None if raw in (None, "") else int(raw)
        except (TypeError, ValueError):
            continue
    updated = await set_limits(db, plan, values)
    return {"plan": plan, "limits": updated}


@router.put("/user/{user_id}")
async def plan_of_user(
    user_id: str,
    data: dict,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await db.get(User, user_id)
    if target is None:
        return {"ok": False}
    if target.is_admin:
        return {"ok": False, "error": "Нельзя менять подписку администратора"}
    plan = str((data or {}).get("plan") or "free").lower()
    if plan not in PLANS:
        plan = "free"
    target.plan = plan
    days_raw = (data or {}).get("days") if "days" in (data or {}) else (await get_limits(db, plan)).get("subscription_days", 30)
    if plan == "free":
        target.subscription_until = None
    elif days_raw in (None, "", 0, "0"):
        target.subscription_until = None
    else:
        try:
            days = max(1, min(int(days_raw), 3650))
        except (TypeError, ValueError):
            days = 30
        target.subscription_until = utcnow() + timedelta(days=days)
    await db.commit()
    return {
        "ok": True,
        "plan": target.plan,
        "subscription_until": target.subscription_until.isoformat() if target.subscription_until else None,
    }


@router.post("/user/{user_id}/reset")
async def reset_user_usage(
    user_id: str,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await db.get(User, user_id)
    if target is None:
        return {"ok": False, "error": "Пользователь не найден"}
    target.usage_reset_at = utcnow()
    await db.execute(
        update(Chat)
        .where(Chat.user_id == target.id)
        .values(compress_count=0, compress_date=None)
    )
    await db.commit()
    return {"ok": True, "reset_at": target.usage_reset_at.isoformat()}