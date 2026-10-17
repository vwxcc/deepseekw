"""Plan limits: read for everyone, edited by the administrator."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_admin, get_current_user, get_db, require_csrf
from ..models import AudioGeneration, Chat, File, Message, ModelSet, PlanLimit, Post, Role, RouteType, UsageEvent, User, utcnow
from ..services.limits import (
    LABELS,
    PLANS,
    all_limits,
    get_limits,
    get_models_for_plan,
    set_limits,
    set_models_for_plan,
)
from ..services.usage import window_spend as usage_window_spend

router = APIRouter(prefix="/api/limits", tags=["limits"])


async def _window_spend(
    db: AsyncSession, user_id: str, hours: int, plan: str = "free"
) -> tuple[float, int]:
    """Dollar spend inside a rolling window, straight from the billing journal.

    Every billed call wrote its own price snapshot, so no price lookup or flat
    fallback rate is needed here — the sum is already in dollars.
    """
    return await usage_window_spend(db, user_id, hours)


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
    budget_raw = limits.get("budget_usd")
    budget = float(budget_raw) if budget_raw is not None else None
    window_spend, window_reqs = await _window_spend(
        db, user.id, window_hours, user.plan or "free"
    )
    audio_cutoff = utcnow() - timedelta(hours=window_hours)
    audio_generations = await db.scalar(
        select(func.count()).select_from(AudioGeneration).where(
            AudioGeneration.user_id == user.id,
            AudioGeneration.created_at >= audio_cutoff,
        )
    )
    percent = (
        0.0 if budget is None else
        (100.0 if budget == 0 else round(min(100.0, window_spend / budget * 100.0), 1))
    )
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
            "audio_generations": int(audio_generations or 0),
            "audio_limit": limits.get("audio_generations", 4),
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
    """Users with exact billed cost and current rolling-window spend."""
    usage = (
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
                func.coalesce(usage.c.requests, 0),
                func.coalesce(usage.c.tin, 0),
                func.coalesce(usage.c.tout, 0),
            ).outerjoin(usage, usage.c.uid == User.id).order_by(User.created_at)
        )
    ).all()

    out: list[dict] = []
    for user, requests, tin, tout in rows:
        limits = await get_limits(db, user.plan or "free")
        window_hours = max(1, int(limits.get("window_hours") or 5))
        budget_raw = limits.get("budget_usd")
        budget = float(budget_raw) if budget_raw is not None else None
        window_spend, window_calls = await usage_window_spend(db, user.id, window_hours)
        total_cost = await db.scalar(
            select(func.coalesce(func.sum(UsageEvent.cost_usd), 0)).where(
                UsageEvent.user_id == user.id
            )
        )
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
                "plan_price": float(limits.get("price") or 0),
                "cost": round(float(total_cost or 0), 6),
                "spend_usd": window_spend,
                "budget_usd": budget,
                "window_hours": window_hours,
                "window_requests": window_calls,
                "window_percent": (
                    0.0 if budget is None else
                    (100.0 if budget == 0 else round(min(100.0, window_spend / budget * 100), 1))
                ),
                "usage_reset_at": user.usage_reset_at.isoformat() if user.usage_reset_at else None,
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный тариф")
    # Preserve decimal dollars; blank inputs clear their stored overrides.
    float_keys = {"budget_usd", "price"}
    allowed_keys = set((await get_limits(db, plan)).keys())
    values: dict[str, int | float | None] = {}
    for key, raw in (data or {}).items():
        if key not in allowed_keys:
            continue
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            values[key] = None
            continue
        try:
            number = float(raw) if key in float_keys else int(raw)
            if isinstance(number, float) and (number != number or abs(number) == float("inf")):
                continue
            if number < 0 or (key == "window_hours" and number < 1):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Недопустимое значение лимита: {key}",
                )
            values[key] = number
        except (TypeError, ValueError, OverflowError):
            continue
    updated = await set_limits(db, plan, values)
    return {"plan": plan, "limits": updated}


@router.post("/user/{user_id}/reset-window")
async def reset_user_usage_window(
    user_id: str,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Reset this user's quota window without deleting billing history."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    target.usage_reset_at = utcnow()
    await db.commit()
    return {"ok": True, "usage_reset_at": target.usage_reset_at.isoformat()}


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
