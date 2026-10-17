"""Small process-wide guard for active per-user TTS requests.

The registry is shared by requests from all browser sessions on this app process.
Database reservations supplement status discovery across workers.
"""
from __future__ import annotations

from datetime import timedelta
from threading import Lock

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AudioGenerationLock, utcnow


class AudioGenerationInProgress(RuntimeError):
    """The account already has an active audio generation."""

    def __init__(self, message_id: str):
        self.message_id = message_id
        super().__init__("Audio generation is already in progress.")


_active_by_user: dict[str, str] = {}
_guard = Lock()


def begin_audio_generation(user_id: str, message_id: str) -> None:
    """Atomically start one generation for an account or reject a parallel one."""
    with _guard:
        active_message_id = _active_by_user.get(user_id)
        if active_message_id is not None:
            raise AudioGenerationInProgress(active_message_id)
        _active_by_user[user_id] = message_id


def active_audio_generation(user_id: str) -> str | None:
    """Get this account's active message ID, if any."""
    with _guard:
        return _active_by_user.get(user_id)


def finish_audio_generation(user_id: str, message_id: str) -> None:
    """Clear only the reservation owned by this request."""
    with _guard:
        if _active_by_user.get(user_id) == message_id:
            _active_by_user.pop(user_id, None)


# SQLite is the shared coordination layer across app workers/devices. TTS can
# use a preprocessing request and a synthesis request, so allow generous time
# before considering a persisted lock abandoned.
AUDIO_GENERATION_LOCK_STALE_AFTER = timedelta(minutes=30)


async def claim_shared_audio_generation(
    db: AsyncSession,
    user_id: str,
    message_id: str,
    *,
    _retry_stale: bool = True,
) -> AudioGenerationLock:
    """Atomically reserve the account's single active TTS slot in the database.

    The primary key on AudioGenerationLock.user_id enforces exclusivity even
    when two requests land on different application workers at the same time.
    """
    stale_before = utcnow() - AUDIO_GENERATION_LOCK_STALE_AFTER
    existing = await db.get(AudioGenerationLock, user_id)
    if existing is not None:
        if existing.created_at >= stale_before:
            raise AudioGenerationInProgress(existing.message_id)
        await db.delete(existing)
        await db.commit()

    lock = AudioGenerationLock(
        user_id=user_id,
        message_id=message_id,
        created_at=utcnow(),
    )
    db.add(lock)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        existing = await db.get(AudioGenerationLock, user_id)
        if existing is None:
            raise
        # Another worker may have raced with stale-lock cleanup. Retry once
        # only when the row is still demonstrably stale; an active row wins.
        if _retry_stale and existing.created_at < utcnow() - AUDIO_GENERATION_LOCK_STALE_AFTER:
            await db.delete(existing)
            await db.commit()
            return await claim_shared_audio_generation(
                db, user_id, message_id, _retry_stale=False
            )
        raise AudioGenerationInProgress(existing.message_id) from exc
    return lock


async def shared_active_audio_generation(
    db: AsyncSession, user_id: str
) -> str | None:
    """Read the active TTS message from shared storage and prune stale locks."""
    lock = await db.get(AudioGenerationLock, user_id)
    if lock is None:
        return None
    if lock.created_at < utcnow() - AUDIO_GENERATION_LOCK_STALE_AFTER:
        await db.delete(lock)
        await db.commit()
        return None
    return lock.message_id


async def finish_shared_audio_generation(
    db: AsyncSession, user_id: str, message_id: str
) -> None:
    """Release the shared lock only if it still belongs to this generation."""
    lock = await db.get(AudioGenerationLock, user_id)
    if lock is not None and lock.message_id == message_id:
        await db.delete(lock)
        await db.commit()
