"""Chat CRUD endpoints."""
from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import SessionLocal
from ..deps import get_current_user, get_db, get_owned_chat, require_csrf
from ..models import Attachment, Chat, Message, MessageStatus, ModelSet, ModelSetEntry, Project, Role, RouteType, Suggestion, User, utcnow
from ..schemas import ChatCreate, ChatOut, ChatUpdate, ShareOut, SharedChatOut
from ..services.limits import allow, get_limits, normalize_plan

router = APIRouter(prefix="/api/chats", tags=["chats"])


async def _is_safe_to_delete_empty_chat(
    db: AsyncSession, chat: Chat, *, older_than=None
) -> bool:
    """Delete only disposable drafts; never erase actual or linked user data."""
    if chat.deleted_at is not None or chat.is_public or chat.share_token:
        return False
    if chat.is_pinned or chat.project_id or chat.bundle_id or chat.source_chat_id:
        return False
    if chat.summary and chat.summary.strip():
        return False
    # A renamed chat is an explicit user action; preserve it even while empty.
    if (chat.title or "").strip() != "Новый чат":
        return False
    if chat.mode not in ("chat", "research"):
        return False
    if older_than is not None and (chat.created_at is None or chat.created_at >= older_than):
        return False

    child_count = await db.scalar(
        select(func.count()).select_from(Chat).where(Chat.source_chat_id == chat.id)
    )
    if child_count:
        return False
    message_count = await db.scalar(
        select(func.count()).select_from(Message).where(Message.chat_id == chat.id)
    )
    if message_count:
        return False
    suggestion_count = await db.scalar(
        select(func.count()).select_from(Suggestion).where(Suggestion.chat_id == chat.id)
    )
    return not suggestion_count


async def cleanup_stale_empty_chats() -> int:
    """Prune only untouched default drafts older than seven days."""
    cutoff = utcnow() - timedelta(days=7)
    async with SessionLocal() as db:
        result = await db.execute(
            select(Chat).where(
                Chat.created_at < cutoff,
                Chat.deleted_at.is_(None),
                Chat.is_public.is_(False),
                Chat.is_pinned.is_(False),
                Chat.project_id.is_(None),
                Chat.bundle_id.is_(None),
                Chat.source_chat_id.is_(None),
                Chat.mode.in_(("chat", "research")),
                Chat.title == "Новый чат",
            )
        )
        candidates = result.scalars().all()
        deleted = 0
        for chat in candidates:
            if await _is_safe_to_delete_empty_chat(db, chat, older_than=cutoff):
                await db.delete(chat)
                deleted += 1
        if deleted:
            await db.commit()
        return deleted


@router.get("", response_model=list[ChatOut])
async def list_chats(
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Chat).where(Chat.user_id == user.id, Chat.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Chat.title.ilike(f"%{q}%"))
    stmt = stmt.order_by(Chat.updated_at.desc())
    result = await db.execute(stmt)
    chats = result.scalars().all()
    if not chats:
        return []
    active_result = await db.execute(
        select(Message.chat_id).where(
            Message.chat_id.in_([chat.id for chat in chats]),
            Message.role == Role.assistant,
            Message.status.in_([MessageStatus.queued, MessageStatus.processing]),
        )
    )
    active_chat_ids = set(active_result.scalars().all())
    return [
        ChatOut.model_validate(chat).model_copy(update={"is_generating": chat.id in active_chat_ids})
        for chat in chats
    ]


@router.get("/shared", response_model=list[SharedChatOut])
async def shared_chats(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Chat)
        .where(
            Chat.user_id == user.id,
            Chat.is_public.is_(True),
            Chat.deleted_at.is_(None),
        )
        .order_by(Chat.updated_at.desc())
    )
    out: list[SharedChatOut] = []
    for c in result.scalars().all():
        cnt = await db.scalar(
            select(func.count()).select_from(Message).where(Message.chat_id == c.id)
        )
        out.append(
            SharedChatOut(
                id=c.id,
                title=c.title,
                share_token=c.share_token or "",
                created_at=c.created_at,
                messages=cnt or 0,
            )
        )
    return out


@router.post("", response_model=ChatOut, status_code=status.HTTP_201_CREATED)
async def create_chat(
    data: ChatCreate,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    mode = (data.mode or "chat").strip().lower()
    if mode not in ("chat", "code"):
        mode = "chat"
    if mode == "code":
        limits = await get_limits(db, user.plan or "free")
        agents = (
            await db.scalar(
                select(func.count())
                .select_from(Chat)
                .where(
                    Chat.user_id == user.id,
                    Chat.mode == "code",
                    Chat.deleted_at.is_(None),
                )
            )
            or 0
        )
        allowed, message = allow(limits, "code_agents", agents)
        if not allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"{message}. Удалите старый проект или оформите Pro.",
            )
    chat = Chat(user_id=user.id, title=data.title.strip() or "Новый чат", mode=mode)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return ChatOut.model_validate(chat)


@router.post("/{chat_id}/branch", response_model=ChatOut, status_code=status.HTTP_201_CREATED)
async def branch_chat(
    source: Chat = Depends(get_owned_chat),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Create a new independent chat from a snapshot of the source history."""
    branch = Chat(
        user_id=user.id,
        title=("Ветка · " + (source.title or "Чат"))[:255],
        mode=source.mode or "chat",
        model_name=source.model_name,
        model_set_id=source.model_set_id,
        bundle_id=source.bundle_id,
        effort=source.effort,
        source_chat_id=source.id,
        source_chat_title=source.title or "Чат",
    )
    db.add(branch)
    await db.flush()
    result = await db.execute(
        select(Message).where(Message.chat_id == source.id).order_by(Message.created_at, Message.id)
    )
    originals = result.scalars().all()
    id_map = {item.id: str(uuid.uuid4()) for item in originals}
    clones = []
    for item in originals:
        cloned_status = item.status
        if cloned_status in (MessageStatus.queued, MessageStatus.processing):
            cloned_status = MessageStatus.completed
        clones.append(Message(
            id=id_map[item.id], chat_id=branch.id,
            user_id=user.id if item.user_id is not None else None,
            role=item.role, content=item.content or "",
            parent_message_id=id_map.get(item.parent_message_id),
            status=cloned_status, model_set_id=item.model_set_id, error=item.error,
            tokens_in=item.tokens_in or 0, tokens_out=item.tokens_out or 0,
            tokens_cached=item.tokens_cached or 0, rating=item.rating or 0,
            sources=item.sources, tool_runs=item.tool_runs,
            execution_target=item.execution_target or "site", created_at=item.created_at,
        ))
    if clones:
        db.add_all(clones)
        await db.flush()
        old_ids = list(id_map)
        attachments = await db.execute(select(Attachment).where(Attachment.message_id.in_(old_ids)))
        db.add_all([
            Attachment(message_id=id_map[item.message_id], file_id=item.file_id)
            for item in attachments.scalars().all() if item.message_id in id_map
        ])
        suggestions = await db.execute(select(Suggestion).where(Suggestion.message_id.in_(old_ids)))
        db.add_all([
            Suggestion(message_id=id_map[item.message_id], chat_id=branch.id,
                       position=item.position, text=item.text)
            for item in suggestions.scalars().all() if item.message_id in id_map
        ])
    await db.commit()
    await db.refresh(branch)
    return ChatOut.model_validate(branch)


@router.get("/{chat_id}", response_model=ChatOut)
async def get_chat(chat: Chat = Depends(get_owned_chat)):
    return ChatOut.model_validate(chat)


@router.patch("/{chat_id}", response_model=ChatOut)
async def rename_chat(
    data: ChatUpdate,
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    if data.title is not None:
        chat.title = data.title.strip() or chat.title
    if data.is_pinned is not None:
        chat.is_pinned = data.is_pinned
    if "project_id" in data.model_fields_set:
        if data.project_id is None:
            chat.project_id = None
        else:
            project = await db.get(Project, data.project_id)
            if project is None or project.user_id != chat.user_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Проект не найден")
            chat.project_id = project.id
    if data.model_set_id is not None:
        cluster = await db.get(ModelSet, data.model_set_id)
        if cluster is None or not cluster.is_active or cluster.is_router or cluster.route_type != RouteType.MAIN:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Выбранный кластер недоступен")
        owner = await db.get(User, chat.user_id)
        if not bool(getattr(cluster, "free_access", True)) and owner and normalize_plan(owner.plan) != "pro" and not owner.is_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Эта модель доступна только по подписке Pro.")
        count = await db.scalar(select(func.count()).select_from(ModelSetEntry).where(
            ModelSetEntry.model_set_id == cluster.id, ModelSetEntry.is_active.is_(True)))
        if not count:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "В выбранном кластере нет активной модели")
        chat.model_set_id = cluster.id
    await db.commit()
    await db.refresh(chat)
    return ChatOut.model_validate(chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(chat)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{chat_id}/empty", status_code=status.HTTP_204_NO_CONTENT)
async def delete_empty_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Best-effort frontend cleanup backed by a strict server-side safety check."""
    if not await _is_safe_to_delete_empty_chat(db, chat):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Чат содержит данные или сохранённые настройки; он не был удалён.",
        )
    await db.delete(chat)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _share_url(token: str | None) -> str | None:
    return f"/?share={token}" if token else None


@router.get("/{chat_id}/share", response_model=ShareOut)
async def share_status(chat: Chat = Depends(get_owned_chat)):
    return ShareOut(
        is_public=chat.is_public,
        share_token=chat.share_token,
        url=_share_url(chat.share_token) if chat.is_public else None,
    )


@router.post("/{chat_id}/share", response_model=ShareOut)
async def share_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    if not chat.share_token:
        chat.share_token = uuid.uuid4().hex
    chat.is_public = True
    await db.commit()
    return ShareOut(
        is_public=True, share_token=chat.share_token, url=_share_url(chat.share_token)
    )


@router.delete("/{chat_id}/share", response_model=ShareOut)
async def unshare_chat(
    chat: Chat = Depends(get_owned_chat),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    chat.is_public = False
    await db.commit()
    return ShareOut(is_public=False, share_token=chat.share_token, url=None)
