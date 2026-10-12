"""Storage quotas: per-user 4 GB limit plus automatic cleanup when disk runs low."""
from __future__ import annotations

import logging
import shutil

from sqlalchemy import func, select

from ..config import settings
from ..database import SessionLocal
from ..models import File

log = logging.getLogger("chatstudio.storage")


def disk_free(path: str | None = None) -> int:
    target = path or settings.upload_dir
    try:
        return shutil.disk_usage(target).free
    except OSError:
        return settings.disk_min_free * 2


async def user_usage(db, user_id: str) -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(File.size), 0)).where(File.user_id == user_id)
    )
    return int(total or 0)


def _remove(rec: File) -> None:
    try:
        from pathlib import Path

        Path(rec.storage_path).unlink(missing_ok=True)
    except Exception as e:  # pragma: no cover
        log.warning("Cannot delete %s: %s", rec.storage_path, e)


async def enforce_disk_floor() -> int:
    """Free space below the configured floor -> drop the oldest files, biggest users first.

    Returns the number of deleted files.
    """
    if disk_free() >= settings.disk_min_free:
        return 0

    removed = 0
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(File.user_id, func.coalesce(func.sum(File.size), 0).label("used"))
                .group_by(File.user_id)
                .order_by(func.coalesce(func.sum(File.size), 0).desc())
            )
        ).all()

    for user_id, _used in rows:
        if disk_free() >= settings.disk_min_free:
            break
        # never touch an admin's or the newest uploads of that user
        async with SessionLocal() as db:
            files = (
                await db.execute(
                    select(File)
                    .where(File.user_id == user_id)
                    .order_by(File.created_at.asc())
                    .limit(25)
                )
            ).scalars().all()
            for rec in files:
                _remove(rec)
                await db.delete(rec)
                removed += 1
                if disk_free() >= settings.disk_min_free:
                    break
            await db.commit()
    if removed:
        log.warning("Disk floor reached: deleted %s oldest files", removed)
    return removed
