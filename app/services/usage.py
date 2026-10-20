"""Dollar accounting: every model call is billed, whatever it was for.

Helper calls (title, suggestions, routing, search queries, compression) cost real
money, so each one writes a :class:`UsageEvent` row carrying the price snapshot of
the model that served it. Limits are then a plain ``SUM(cost_usd)`` over a rolling
window, which keeps the number meaningful even if prices are edited later.
"""
from __future__ import annotations

from datetime import timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Message, ModelSetEntry, Role, UsageEvent, User, utcnow


def est(text) -> int:
    """Cheap token estimate (about 4 characters per token)."""
    return max(1, len(str(text or "")) // 4)


def price_of(entry: ModelSetEntry | None) -> tuple[float, float, float]:
    """(input, output, cached) price per 1M tokens for a model entry."""
    if entry is None:
        return 0.0, 0.0, 0.0
    return (
        float(getattr(entry, "price_in", 0.0) or 0.0),
        float(getattr(entry, "price_out", 0.0) or 0.0),
        float(getattr(entry, "price_cache", 0.0) or 0.0),
    )


def cost_usd(
    entry: ModelSetEntry | None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    tokens_cached: int = 0,
) -> float:
    """Real dollar cost of one call, from that model's own price list."""
    pin, pout, pcache = price_of(entry)
    tin = max(0, int(tokens_in or 0))
    tout = max(0, int(tokens_out or 0))
    tcached = min(max(0, int(tokens_cached or 0)), tin)
    # A zero cache rate means it is not configured, not that cached input is free.
    if pcache <= 0 and pin > 0:
        pcache = pin
    # cached tokens are billed at the cache rate instead of the full input rate
    billed_in = max(0, tin - tcached)
    total = (
        billed_in / 1e6 * pin
        + tcached / 1e6 * pcache
        + tout / 1e6 * pout
    )
    return round(total, 8)


async def record(
    db: AsyncSession,
    *,
    user_id: str | None,
    chat_id: str | None,
    message_id: str | None,
    entry: ModelSetEntry | None,
    action: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    tokens_cached: int = 0,
) -> float:
    """Append one billed call to the journal. Returns its cost in dollars."""
    tin = max(0, int(tokens_in or 0))
    tout = max(0, int(tokens_out or 0))
    tcached = max(0, int(tokens_cached or 0))
    if tin + tout <= 0:
        return 0.0
    cost = cost_usd(entry, tin, tout, tcached)
    db.add(
        UsageEvent(
            user_id=user_id,
            chat_id=chat_id,
            message_id=message_id,
            model_set_id=getattr(entry, "model_set_id", None),
            entry_id=getattr(entry, "id", None),
            model=getattr(entry, "model", "") or "",
            action=action,
            tokens_in=tin,
            tokens_out=tout,
            tokens_cached=tcached,
            cost_usd=cost,
        )
    )
    return cost


async def account(
    db: AsyncSession,
    chat_id: str | None,
    model_set_id: str | None,
    tokens_in: int,
    tokens_out: int,
    *,
    entry: ModelSetEntry | None = None,
    user_id: str | None = None,
    message_id: str | None = None,
    action: str = "helper",
    tokens_cached: int = 0,
) -> float:
    """Bill one call and fold its tokens into the chat's latest answer.

    The message-side counters keep the per-answer token display working; the
    authoritative money record is the ``UsageEvent`` row written here.
    """
    total = int(tokens_in or 0) + int(tokens_out or 0)
    if not chat_id or total <= 0:
        return 0.0

    if user_id is None:
        from ..models import Chat

        chat = await db.get(Chat, chat_id)
        user_id = chat.user_id if chat is not None else None

    row = None
    if message_id:
        candidate = await db.get(Message, message_id)
        if candidate is not None and candidate.chat_id == chat_id and candidate.role == Role.assistant:
            row = candidate
    if row is None:
        row = (
            await db.execute(
                select(Message)
                .where(Message.chat_id == chat_id, Message.role == Role.assistant)
                .order_by(Message.created_at.desc())
                .limit(1)
            )
        ).scalars().first()
    if row is not None:
        row.tokens_in = (row.tokens_in or 0) + int(tokens_in or 0)
        row.tokens_out = (row.tokens_out or 0) + int(tokens_out or 0)
        if tokens_cached:
            row.tokens_cached = (row.tokens_cached or 0) + int(tokens_cached or 0)
        if model_set_id and not row.model_set_id:
            row.model_set_id = model_set_id

    return await record(
        db,
        user_id=user_id,
        chat_id=chat_id,
        message_id=message_id,
        entry=entry,
        action=action,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        tokens_cached=tokens_cached,
    )


async def window_spend(
    db: AsyncSession, user_id: str, hours: int
) -> tuple[float, int]:
    """Dollar spend of a user inside a rolling window, plus the number of calls."""
    since = utcnow() - timedelta(hours=max(1, int(hours or 5)))
    user = await db.get(User, user_id)
    reset_at = user.usage_reset_at if user is not None else None
    if reset_at is not None:
        # SQLite stores timestamps without tzinfo; application timestamps are UTC.
        if reset_at.tzinfo is not None:
            reset_at = reset_at.astimezone(timezone.utc).replace(tzinfo=None)
        since = max(since, reset_at)
    rows = (
        await db.execute(
            select(UsageEvent.cost_usd).where(
                UsageEvent.user_id == user_id, UsageEvent.created_at >= since
            )
        )
    ).scalars().all()
    return round(sum(float(r or 0.0) for r in rows), 6), len(rows)
