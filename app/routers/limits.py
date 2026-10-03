"""Plan limits: read for everyone, edited by the administrator."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_admin, get_current_user, get_db, require_csrf
from ..models import Chat, File, Message, ModelSet, Post, Role, RouteType, User
from ..services.limits import (
    LABELS,
    PLANS,
    all_limits,
    get_limits,
    get_models_for_plan,
    set_limits,
    set_models_for_plan,
)

router = APIRouter(prefix="/api/limits", tags=["limits"])


@router.get("")
async def my_limits(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Current plan + limits + live usage counters."""
    limits = await get_limits(db, user.plan or "free")
    files = await db.scalar(
        select(func.count()).select_from(File).where(File.user_id == user.id)
    )
    used = await db.scalar(
        select(func.coalesce(func.sum(File.size), 0)).where(File.user_id == user.id)
    )
    posts = await db.scalar(
        select(func.count()).select_from(Post).where(Post.user_id == user.id)
    )
    agents = await db.scalar(
        select(func.count())
        .select_from(Chat)
        .where(Chat.user_id == user.id, Chat.mode == "code", Chat.deleted_at.is_(None))
    )
    return {
        "plan": user.plan or "free",
        "labels": LABELS,
        "limits": limits,
        "usage": {
            "files": files or 0,
            "storage": int(used or 0),
            "posts": posts or 0,
            "code_agents": agents or 0,
        },
    }


@router.get("/all")
async def limits_all(
    admin: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)
) -> dict:
    models = (
        await db.execute(
            select(ModelSet).where(ModelSet.route_type == RouteType.MAIN).order_by(ModelSet.name)
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
        .where(Message.role == Role.assistant)
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
        limits = await get_limits(db, user.plan or "free")
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
                "plan": user.plan or "free",
                "is_admin": bool(user.is_admin),
                "avatar": user.avatar or 0,
                "requests": int(requests or 0),
                "tokens_in": int(tin or 0),
                "tokens_out": int(tout or 0),
                "storage": int(used or 0),
                "plan_price": int(limits.get("price") or 0),
                "cost": round(tokens / 1000 * rate, 2),
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
            values[key] = int(raw)
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
    plan = str((data or {}).get("plan") or "free").lower()
    target.plan = plan if plan in PLANS else "free"
    await db.commit()
    return {"ok": True, "plan": target.plan}
