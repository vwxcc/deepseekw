"""Chat / message business logic helpers."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Attachment, File, Message, Suggestion
from ..schemas import AttachmentOut, MessageOut
from .files import image_to_data_url


def attachment_out(att: Attachment, f: File) -> AttachmentOut:
    return AttachmentOut(
        id=att.id,
        file_id=f.id,
        name=f.original_name,
        kind=f.kind,
        size=f.size,
        mime_type=f.mime_type or "",
    )


def message_out(
    m: Message,
    suggestions: list[str] | None = None,
    attachments: list[AttachmentOut] | None = None,
) -> MessageOut:
    return MessageOut(
        id=m.id,
        chat_id=m.chat_id,
        role=m.role.value,
        content=m.content,
        parent_message_id=m.parent_message_id,
        status=m.status.value,
        error=m.error,
        created_at=m.created_at,
        rating=m.rating or 0,
        tokens_in=m.tokens_in or 0,
        tokens_out=m.tokens_out or 0,
        tokens_cached=m.tokens_cached or 0,
        suggestions=suggestions or [],
        attachments=attachments or [],
    )


async def message_attachments(
    db: AsyncSession, message_ids: list[str]
) -> dict[str, list[AttachmentOut]]:
    """Map message_id -> list of attachments (with file metadata)."""
    out: dict[str, list[AttachmentOut]] = {}
    if not message_ids:
        return out
    res = await db.execute(
        select(Attachment, File)
        .join(File, File.id == Attachment.file_id)
        .where(Attachment.message_id.in_(message_ids))
    )
    for att, f in res.all():
        out.setdefault(att.message_id, []).append(attachment_out(att, f))
    return out


async def build_message_tree(
    db: AsyncSession, messages: list[Message]
) -> list[MessageOut]:
    """Build a nested tree of messages from a flat chronological list."""
    ids = [m.id for m in messages]

    sugg: dict[str, list[str]] = {}
    if ids:
        res = await db.execute(
            select(Suggestion)
            .where(Suggestion.message_id.in_(ids))
            .order_by(Suggestion.message_id, Suggestion.position)
        )
        for s in res.scalars().all():
            sugg.setdefault(s.message_id, []).append(s.text)

    atts = await message_attachments(db, ids)

    by_id: dict[str, MessageOut] = {
        m.id: message_out(m, sugg.get(m.id), atts.get(m.id)) for m in messages
    }
    roots: list[MessageOut] = []
    for node in by_id.values():
        if node.parent_message_id and node.parent_message_id in by_id:
            by_id[node.parent_message_id].children.append(node)
        else:
            roots.append(node)
    return roots


async def ancestor_chain(
    db: AsyncSession,
    message_id: str,
    include_attachments: bool = True,
    summary_upto: str | None = None,
) -> list[dict]:
    """Linear dialogue (oldest first) ending at ``message_id``.

    Image attachments become multimodal content parts (so a vision model can
    actually see them); documents are inlined as text. If ``summary_upto`` is
    given, everything up to and including that message is dropped (it lives in
    the chat summary instead).
    """
    chain: list[dict] = []
    current_id: str | None = message_id
    seen: set[str] = set()
    while current_id and current_id not in seen:
        if summary_upto and current_id == summary_upto:
            break
        seen.add(current_id)
        msg = await db.get(Message, current_id)
        if msg is None:
            break

        text = msg.content or ""
        images: list[dict] = []
        if include_attachments:
            res = await db.execute(
                select(Attachment, File)
                .join(File, File.id == Attachment.file_id)
                .where(Attachment.message_id == msg.id)
            )
            for _att, rec in res.all():
                if rec.kind == "image":
                    url = image_to_data_url(rec.storage_path, rec.mime_type or "")
                    if url:
                        images.append(
                            {"type": "image_url", "image_url": {"url": url}}
                        )
                elif rec.extracted_text:
                    text += (
                        f"\n\n[Вложение: {rec.original_name}]\n"
                        f"{rec.extracted_text[: settings.max_attachment_chars]}"
                    )

        if images:
            content: list | str = [
                {"type": "text", "text": text or "(см. изображение)"}
            ] + images
        else:
            content = text
        chain.append({"role": msg.role.value, "content": content})
        current_id = msg.parent_message_id
    chain.reverse()
    return chain
