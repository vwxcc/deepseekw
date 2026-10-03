"""Plan limits: read for everyone, edited by the administrator."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_admin, get_current_user, get_db, require_csrf
from ..models import Chat, File, Post, User
from ..services.limits import LABELS, PLANS, all_limits, get_limits, set_limits

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
    return {"plans": list(PLANS), "labels": LABELS, "limits": await all_limits(db)}


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
