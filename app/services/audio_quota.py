"""Rolling per-user quota for generated voice answers."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AudioGeneration, utcnow
from .limits import get_limits


class AudioGenerationInProgress(Exception):
    """Raised when this user already has a live voice-generation job."""


class AudioQuotaExceeded(Exception):
    """Raised when a user has used all voice generations in the current window."""

    def __init__(self, limit: int, hours: int, used: int):
        self.limit = limit
        self.hours = hours
        self.used = used
        super().__init__(
            f"Лимит голосовых ответов исчерпан: {used} из {limit} за {hours} ч. "
            "Попробуйте позже."
        )


async def reserve_audio_generation(
    db: AsyncSession, user_id: str, message_id: str, plan: str
) -> AudioGeneration:
    """Reserve one slot before making the external TTS request.

    Reservations count while generation is running and remain on success. The
    caller must release a reservation if generation or persistence fails.
    """
    limits = await get_limits(db, plan or "free")
    raw_limit = limits.get("audio_generations", 4)
    hours = max(1, int(limits.get("window_hours") or 5))
    now = utcnow()
    cutoff = now - timedelta(hours=hours)
    active_cutoff = now - timedelta(minutes=15)

    # Recover a reservation left behind by a crashed worker.
    await db.execute(
        update(AudioGeneration)
        .where(
            AudioGeneration.user_id == user_id,
            AudioGeneration.status == "generating",
            AudioGeneration.created_at < active_cutoff,
        )
        .values(status="completed")
    )
    active_id = await db.scalar(
        select(AudioGeneration.id)
        .where(AudioGeneration.user_id == user_id, AudioGeneration.status == "generating")
        .limit(1)
    )
    if active_id:
        await db.commit()
        raise AudioGenerationInProgress(
            "Уже создаётся одна озвучка. Дождитесь её завершения, затем запускайте следующую."
        )

    # Bound storage growth: old events for this user are no longer useful.
    await db.execute(
        delete(AudioGeneration).where(
            AudioGeneration.user_id == user_id,
            AudioGeneration.created_at < cutoff,
        )
    )
    used = await db.scalar(
        select(func.count())
        .select_from(AudioGeneration)
        .where(
            AudioGeneration.user_id == user_id,
            AudioGeneration.created_at >= cutoff,
        )
    )
    used = int(used or 0)
    if raw_limit is not None:
        limit = max(0, int(raw_limit))
        if used >= limit:
            await db.commit()
            raise AudioQuotaExceeded(limit, hours, used)

    reservation = AudioGeneration(
        user_id=user_id,
        message_id=message_id,
        created_at=now,
        status="generating",
    )
    db.add(reservation)
    try:
        await db.commit()
    except IntegrityError as exc:
        # The partial unique index closes the race between simultaneous requests.
        await db.rollback()
        raise AudioGenerationInProgress(
            "Уже создаётся одна озвучка. Дождитесь её завершения, затем запускайте следующую."
        ) from exc
    return reservation


async def release_audio_generation(
    db: AsyncSession, reservation: AudioGeneration | None
) -> None:
    """Return a reserved slot after a failed generation."""
    if reservation is None:
        return
    await db.execute(
        delete(AudioGeneration).where(AudioGeneration.id == reservation.id)
    )
    await db.commit()
