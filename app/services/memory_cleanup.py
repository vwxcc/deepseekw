"""One-off cleanup of noisy / duplicated memory entries."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Memory

NOISY_PREFS = (
    "кратко",
    "по делу",
    "минималистичн",
    "будь вежлив",
    "структурируй",
    "используй markdown",
    "отвечай коротко",
)


async def clean_noisy_memories(db: AsyncSession) -> int:
    """Drop generic style preferences («отвечай кратко») and exact duplicates."""
    rows = (await db.execute(select(Memory))).scalars().all()
    seen: set[str] = set()
    removed = 0
    for m in rows:
        text = (m.content or "").strip()
        low = text.lower()
        duplicate = low in seen
        noisy = (m.kind or "fact") == "preference" and len(low) < 140 and any(
            n in low for n in NOISY_PREFS
        )
        if duplicate or noisy:
            await db.delete(m)
            removed += 1
            continue
        seen.add(low)
    return removed
