"""Chat / message business logic helpers."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Attachment, File, Message, Suggestion
from ..schemas import MessageOut


def message_out(m: Message, suggestions: list[str] | None = None) -> MessageOut:
    return MessageOut(
        id=m.id,
        chat_id=m.chat_id,
        role=m.role.value,
        content=m.content,
        parent_message_id=m.parent_message_id,
        status=m.status.value,
        error=m.error,
        created_at=m.created_at,
        suggestions=suggestions or [],
    )


async def build_message_tree(
    db: AsyncSession, messages: list[Message]
) -> list[MessageOut]:
    """Build a nested tree of messages from a flat chronological list."""
    sugg: dict[str, list[str]] = {}
    ids = [m.id for m in messages]
    if ids:
        res = await db.execute(
            select(Suggestion)
            .where(Suggestion.message_id.in_(ids))
            .order_by(Suggestion.message_id, Suggestion.position)
        )
        for s in res.scalars().all():
            sugg.setdefault(s.message_id, []).append(s.text)

    by_id: dict[str, MessageOut] = {
        m.id: message_out(m, sugg.get(m.id)) for m in messages
    }
    roots: list[MessageOut] = []
    for node in by_id.values():
        if node.parent_message_id and node.parent_message_id in by_id:
            by_id[node.parent_message_id].children.append(node)
        else:
            roots.append(node)
    return roots


async def ancestor_chain(
    db: AsyncSession, message_id: str, include_attachments: bool = True
) -> list[dict]:
    """Return the linear dialogue (oldest first) ending at ``message_id``."""
    chain: list[dict] = []
    current_id: str | None = message_id
    seen: set[str] = set()
    while current_id and current_id not in seen:
        seen.add(current_id)
        msg = await db.get(Message, current_id)
        if msg is None:
            break
        content = msg.content
        if include_attachments:
            atts = await db.execute(
                select(Attachment).where(Attachment.message_id == msg.id)
            )
            for att in atts.scalars().all():
                rec = await db.get(File, att.file_id)
                if rec is not None and rec.extracted_text:
                    content += (
                        f"\n\n[Вложение: {rec.original_name}]\n"
                        f"{rec.extracted_text[:20000]}"
                    )
        chain.append({"role": msg.role.value, "content": content})
        current_id = msg.parent_message_id
    chain.reverse()
    return chain
