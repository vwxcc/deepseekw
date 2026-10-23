"""Chat / message business logic helpers."""
from __future__ import annotations

import json

from sqlalchemy import String, cast, func, literal, select
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


def _json_list(raw: str | None) -> list:
    if not raw:
        return []
    try:
        val = json.loads(raw)
    except Exception:
        return []
    return val if isinstance(val, list) else []


def _json_object(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def message_out(
    m: Message,
    suggestions: list[str] | None = None,
    attachments: list[AttachmentOut] | None = None,
) -> MessageOut:
    ui_state = _json_object(getattr(m, "ui_state", None))
    ask = ui_state.get("ask", [])
    quiz = ui_state.get("quiz", [])
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
        sources=_json_list(m.sources),
        tool_runs=_json_list(m.tool_runs),
        ask=ask if isinstance(ask, list) else [],
        quiz=quiz if isinstance(quiz, list) else [],
        execution_target=getattr(m, "execution_target", "site") or "site",
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
    # Walk the parent chain in one recursive query instead of one SELECT per
    # message. The path guard preserves the old cycle protection for damaged data.
    message_table = Message.__table__
    base = select(
        message_table.c.id.label("id"),
        message_table.c.parent_message_id.label("parent_message_id"),
        literal(0).label("depth"),
        (literal("|") + cast(message_table.c.id, String) + literal("|")).label("path"),
    ).where(message_table.c.id == message_id)
    if summary_upto:
        base = base.where(message_table.c.id != summary_upto)
    ancestor_cte = base.cte(name="message_ancestors", recursive=True)
    parent = message_table.alias("ancestor_parent")
    recursive_step = (
        select(
            parent.c.id.label("id"),
            parent.c.parent_message_id.label("parent_message_id"),
            (ancestor_cte.c.depth + 1).label("depth"),
            (ancestor_cte.c.path + cast(parent.c.id, String) + literal("|")).label("path"),
        )
        .select_from(parent.join(ancestor_cte, parent.c.id == ancestor_cte.c.parent_message_id))
        .where(
            func.instr(
                ancestor_cte.c.path,
                literal("|") + cast(parent.c.id, String) + literal("|"),
            ) == 0
        )
    )
    if summary_upto:
        recursive_step = recursive_step.where(
            ancestor_cte.c.parent_message_id != summary_upto
        )
    ancestor_cte = ancestor_cte.union_all(recursive_step)
    result = await db.execute(
        select(Message)
        .join(ancestor_cte, Message.id == ancestor_cte.c.id)
        .order_by(ancestor_cte.c.depth.desc())
    )
    messages = result.scalars().all()
    if not messages:
        return []

    attachments_by_message: dict[str, list[File]] = {}
    if include_attachments:
        result = await db.execute(
            select(Attachment, File)
            .join(File, File.id == Attachment.file_id)
            .where(Attachment.message_id.in_([message.id for message in messages]))
        )
        for attachment, file_record in result.all():
            attachments_by_message.setdefault(attachment.message_id, []).append(file_record)

    chain: list[dict] = []
    for msg in messages:
        text = msg.content or ""
        images: list[dict] = []
        for rec in attachments_by_message.get(msg.id, []):
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
    return chain
