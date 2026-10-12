"""Wall of posts: publish a chat answer publicly, with likes, comments and views."""
from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import (
    Attachment,
    Chat,
    File,
    Message,
    Post,
    PostComment,
    PostVote,
    Role,
    User,
)
from ..schemas import (
    PostCommentIn,
    PostCommentOut,
    PostDetailOut,
    PostIn,
    PostOut,
    PostVoteIn,
)
from ..services.limits import allow, get_limits

router = APIRouter(prefix="/api/posts", tags=["posts"])

PREVIEW_CHARS = 900


async def _counts(db: AsyncSession, post_id: str) -> tuple[int, int, int]:
    likes = (
        await db.scalar(
            select(func.count())
            .select_from(PostVote)
            .where(PostVote.post_id == post_id, PostVote.value > 0)
        )
        or 0
    )
    dislikes = (
        await db.scalar(
            select(func.count())
            .select_from(PostVote)
            .where(PostVote.post_id == post_id, PostVote.value < 0)
        )
        or 0
    )
    comments = (
        await db.scalar(
            select(func.count())
            .select_from(PostComment)
            .where(PostComment.post_id == post_id)
        )
        or 0
    )
    return likes, dislikes, comments


async def _post_out(
    db: AsyncSession, post: Post, uid: str | None, detail: bool = False
):
    likes, dislikes, comments = await _counts(db, post.id)
    my_vote = 0
    if uid:
        vote = (
            await db.execute(
                select(PostVote).where(
                    PostVote.post_id == post.id, PostVote.user_id == uid
                )
            )
        ).scalars().first()
        my_vote = vote.value if vote else 0
    author = await db.get(User, post.user_id)
    author_name = (author.name or author.email) if author else ""
    payload = dict(
        id=post.id,
        user_id=post.user_id,
        author=author_name,
        title=post.title,
        preview=post.preview,
        chat_id=post.chat_id,
        message_id=post.message_id,
        image_file_id=post.image_file_id,
        views=post.views or 0,
        likes=likes,
        dislikes=dislikes,
        comments=comments,
        my_vote=my_vote,
        can_delete=bool(uid and (uid == post.user_id or getattr(author, "is_admin", False))),
        created_at=post.created_at,
    )
    if not detail:
        return PostOut(**payload)

    rows = (
        await db.execute(
            select(PostComment)
            .where(PostComment.post_id == post.id)
            .order_by(PostComment.created_at)
            .limit(200)
        )
    ).scalars().all()
    names: dict[str, str] = {}
    for c in rows:
        if c.user_id not in names:
            u = await db.get(User, c.user_id)
            names[c.user_id] = (u.name or u.email) if u else ""
    payload["comment_list"] = [
        PostCommentOut(
            id=c.id,
            post_id=c.post_id,
            user_id=c.user_id,
            author=names.get(c.user_id, ""),
            text=c.text,
            created_at=c.created_at,
        )
        for c in rows
    ]
    return PostDetailOut(**payload)


@router.get("", response_model=list[PostOut])
async def list_posts(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    limit = max(1, min(limit, 100))
    rows = (
        await db.execute(
            select(Post)
            .where(Post.is_public.is_(True))
            .order_by(Post.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [await _post_out(db, p, user.id) for p in rows]


@router.get("/top", response_model=None)
async def top_post(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """One random post among the most viewed/liked — for the empty state."""
    likes = (
        select(PostVote.post_id, func.count().label("n"))
        .where(PostVote.value > 0)
        .group_by(PostVote.post_id)
        .subquery()
    )
    score = (func.coalesce(Post.views, 0) + func.coalesce(likes.c.n, 0) * 5)
    rows = (
        await db.execute(
            select(Post)
            .outerjoin(likes, likes.c.post_id == Post.id)
            .where(Post.is_public.is_(True))
            .order_by(score.desc(), Post.created_at.desc())
            .limit(10)
        )
    ).scalars().all()
    if not rows:
        return None
    return await _post_out(db, random.choice(list(rows)), user.id)


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    data: PostIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    limits = await get_limits(db, user.plan or "free")
    mine = (
        await db.scalar(
            select(func.count()).select_from(Post).where(Post.user_id == user.id)
        )
        or 0
    )
    allowed, message = allow(limits, "posts", mine)
    if not allowed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"{message}. Оформите Pro для большего."
        )

    chat: Chat | None = None
    if data.chat_id:
        chat = await db.get(Chat, data.chat_id)
        if chat is None or chat.deleted_at is not None or chat.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Чат не найден")

    source: Message | None = None
    if data.message_id:
        source = await db.get(Message, data.message_id)
        if source is not None and chat is not None and source.chat_id != chat.id:
            source = None
    if source is None and chat is not None:
        res = await db.execute(
            select(Message)
            .where(Message.chat_id == chat.id, Message.role == Role.assistant)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        source = res.scalars().first()

    preview = (source.content if source and source.content else "")[:PREVIEW_CHARS]
    if not preview.strip() and chat is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нечего публиковать")

    image_id: str | None = None
    if source is not None:
        res = await db.execute(
            select(File)
            .join(Attachment, Attachment.file_id == File.id)
            .where(Attachment.message_id == source.id, File.kind == "image")
            .limit(1)
        )
        img = res.scalars().first()
        if img is not None:
            image_id = img.id

    title = (data.title or "").strip() or (chat.title if chat else "Пост")
    post = Post(
        user_id=user.id,
        chat_id=chat.id if chat else None,
        message_id=source.id if source else None,
        title=title[:300],
        preview=preview,
        image_file_id=image_id,
    )
    # keep the chat reachable through a public link
    if chat is not None and not chat.is_public:
        import uuid as _uuid

        chat.is_public = True
        if not chat.share_token:
            chat.share_token = _uuid.uuid4().hex
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return await _post_out(db, post, user.id)


@router.get("/{post_id}", response_model=PostDetailOut)
async def get_post(
    post_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(Post, post_id)
    if post is None or not post.is_public:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пост не найден")
    return await _post_out(db, post, user.id, detail=True)


@router.post("/{post_id}/view")
async def view_post(
    post_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    post = await db.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пост не найден")
    post.views = (post.views or 0) + 1
    await db.commit()
    return {"ok": True, "views": post.views}


@router.post("/{post_id}/vote", response_model=PostOut)
async def vote_post(
    post_id: str,
    data: PostVoteIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пост не найден")
    value = max(-1, min(1, int(data.value or 0)))
    row = (
        await db.execute(
            select(PostVote).where(
                PostVote.post_id == post_id, PostVote.user_id == user.id
            )
        )
    ).scalars().first()
    if row is None:
        if value != 0:
            row = PostVote(post_id=post_id, user_id=user.id, value=value)
            db.add(row)
    elif value == 0 or row.value == value:
        await db.delete(row)
    else:
        row.value = value
    await db.commit()
    return await _post_out(db, post, user.id)


@router.post(
    "/{post_id}/comments", response_model=PostCommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    post_id: str,
    data: PostCommentIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пост не найден")
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустой комментарий")
    comment = PostComment(post_id=post_id, user_id=user.id, text=text[:2000])
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return PostCommentOut(
        id=comment.id,
        post_id=comment.post_id,
        user_id=comment.user_id,
        author=(user.name or user.email),
        text=comment.text,
        created_at=comment.created_at,
    )


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пост не найден")
    if post.user_id != user.id and not getattr(user, "is_admin", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    await db.delete(post)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
