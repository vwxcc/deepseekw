"""Plan limits: read for everyone, edited by the administrator."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_admin, get_current_user, get_db, require_csrf
from ..models import Chat, File, Message, ModelSet, PlanLimit, Post, Role, RouteType, User
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


async def _window_spend(
    db: AsyncSession, user_id: str, hours: int, plan: str = "free"
) -> tuple[float, int]:
    """Dollar spend inside a rolling window, using each model's own prices."""
    from datetime import timedelta

    from ..models import ModelSetEntry, utcnow

    since = utcnow() - timedelta(hours=max(1, int(hours or 5)))
    rows = (
        await db.execute(
            select(Message.model_set_id, Message.tokens_in, Message.tokens_out)
            .join(Chat, Chat.id == Message.chat_id)
            .where(
                Chat.user_id == user_id,
                Message.role == Role.assistant,
                Message.created_at >= since,
            )
        )
    ).all()
    if not rows:
        return 0.0, 0

    entries = (await db.execute(select(ModelSetEntry))).scalars().all()
    prices: dict = {}
    for e in entries:
        prices.setdefault(
            e.model_set_id,
            (float(e.price_in or 0), float(e.price_out or 0), float(e.price_cache or 0)),
        )

    # fallback rate per 1k tokens for models without their own price
    limits = await get_limits(db, plan)
    rate = float(limits.get("cost_per_1k") or 0)
    if not rate:
        priced = [p for p in prices.values() if p[0] or p[1]]
        if priced:
            avg_in = sum(p[0] for p in priced) / len(priced)
            avg_out = sum(p[1] for p in priced) / len(priced)
            rate = (avg_in + avg_out) / 2 / 1000.0

    total = 0.0
    tokens = 0
    for msid, tin, tout in rows:
        tin = int(tin or 0)
        tout = int(tout or 0)
        tokens += tin + tout
        pin, pout, _ = prices.get(msid, (0.0, 0.0, 0.0))
        if pin or pout:
            total += tin / 1e6 * pin + tout / 1e6 * pout
        elif rate:
            total += (tin + tout) / 1000.0 * rate
    return round(total, 4), len(rows)


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
    spent = await db.scalar(
        select(func.coalesce(func.sum(Message.tokens_in), 0) + func.coalesce(func.sum(Message.tokens_out), 0))
        .select_from(Message).join(Chat, Chat.id == Message.chat_id)
        .where(Chat.user_id == user.id, Message.role == Role.assistant)
    )
    reqs = await db.scalar(
        select(func.count()).select_from(Message).join(Chat, Chat.id == Message.chat_id)
        .where(Chat.user_id == user.id, Message.role == Role.assistant)
    )
    window_hours = int(limits.get("window_hours") or 5)
    budget = float(limits.get("budget_usd") or 0)
    window_spend, window_reqs = await _window_spend(
        db, user.id, window_hours, user.plan or "free"
    )
    # if prices are not filled in, fall back to a flat rate so the % still means something
    if window_spend == 0.0 and window_reqs and budget:
        rate = float(limits.get("cost_per_1k") or 0)
        if rate:
            window_spend = round((int(spent or 0) and 0) + 0.0, 4)
    percent = round(min(100.0, window_spend / budget * 100.0), 1) if budget else 0.0
    return {
        "compare": await all_limits(db),
        "plan": user.plan or "free",
        "labels": LABELS,
        "limits": limits,
        "window": {
            "hours": window_hours,
            "budget_usd": budget,
            "spend_usd": window_spend,
            "requests": window_reqs,
            "percent": percent,
        },
        "usage": {
            "files": files or 0,
            "storage": int(used or 0),
            "posts": posts or 0,
            "code_agents": agents or 0,
            "tokens": int(spent or 0),
            "requests": int(reqs or 0),
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


@router.post("/{plan}/reset")
async def reset_plan_limits(
    plan: str,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Drop every stored override for a plan so the built-in defaults apply again."""
    from sqlalchemy import delete as sa_delete

    if plan not in PLANS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный тариф")
    await db.execute(
        sa_delete(PlanLimit).where(PlanLimit.plan == plan, PlanLimit.key != "models")
    )
    await db.commit()
    return {"plan": plan, "limits": await get_limits(db, plan)}


@router.post("/reset")
async def reset_all_plans(
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Reset the limits of every plan at once (handy after experiments)."""
    from sqlalchemy import delete as sa_delete

    await db.execute(sa_delete(PlanLimit).where(PlanLimit.key != "models"))
    await db.commit()
    return {"plans": {p: await get_limits(db, p) for p in PLANS}}


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
