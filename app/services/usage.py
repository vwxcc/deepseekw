"""Token accounting: helper calls (title, routing, compression…) cost money too."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Message, Role


def est(text) -> int:
    """Cheap token estimate (about 4 characters per token)."""
    return max(1, len(str(text or "")) // 4)


async def account(
    db: AsyncSession,
    chat_id: str | None,
    model_set_id: str | None,
    tokens_in: int,
    tokens_out: int,
) -> None:
    """Fold a helper call into the chat's latest answer so the limit counts everything."""
    total = int(tokens_in or 0) + int(tokens_out or 0)
    if not chat_id or total <= 0:
        return
    row = (
        await db.execute(
            select(Message)
            .where(Message.chat_id == chat_id, Message.role == Role.assistant)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        return
    row.tokens_in = (row.tokens_in or 0) + int(tokens_in or 0)
    row.tokens_out = (row.tokens_out or 0) + int(tokens_out or 0)
    if model_set_id and not row.model_set_id:
        row.model_set_id = model_set_id
