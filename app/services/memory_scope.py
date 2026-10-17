from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Memory


async def _memory_block(db: AsyncSession, user_id: str, chat_id: str) -> str:
    """Use memories from this chat plus explicitly global, manually saved memories."""
    res = await db.execute(
        select(Memory)
        .where(
            Memory.user_id == user_id,
            or_(
                Memory.chat_id == chat_id,
                and_(Memory.chat_id.is_(None), Memory.message_id.is_(None)),
            ),
        )
        .order_by((Memory.chat_id == chat_id).desc(), Memory.created_at.desc())
        .limit(60)
    )
    rows = [m for m in res.scalars().all() if m.content]
    facts = [
        m.content for m in rows
        if (m.kind or "fact") == "fact"
        and (m.chat_id == chat_id or (m.chat_id is None and m.message_id is None))
    ]
    prefs = [
        m.content for m in rows
        if (m.kind or "fact") == "preference"
        and m.chat_id is None and m.message_id is None
    ]
    chat_prefs = [
        m.content for m in rows
        if (m.kind or "fact") == "preference" and m.chat_id == chat_id
    ]
    out = ""
    if facts:
        out += (
            "\n\n[Что ты помнишь о пользователе]\n"
            + "\n".join("- " + x for x in reversed(facts))
        )
    if prefs:
        out += (
            "\n\n[ПРЕДПОЧТЕНИЯ ПОЛЬЗОВАТЕЛЯ — соблюдай их ВСЕГДА, в каждом ответе]\n"
            + "\n".join("- " + x for x in reversed(prefs))
        )
    if chat_prefs:
        out += (
            "\n\n[ПРЕДПОЧТЕНИЯ, СОХРАНЁННЫЕ ТОЛЬКО В ЭТОМ ЧАТЕ]\n"
            + "\n".join("- " + x for x in reversed(chat_prefs))
        )
    return out
