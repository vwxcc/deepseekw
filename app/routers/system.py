"""Server load: CPU, RAM and disk — shown next to the chat title."""
from __future__ import annotations

import os
import shutil

from fastapi import APIRouter, Depends

from ..config import settings
from ..deps import get_current_user
from ..models import User

router = APIRouter(prefix="/api/system", tags=["system"])


def _meminfo() -> tuple[int, int]:
    try:
        info: dict[str, int] = {}
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                key, _, value = line.partition(":")
                info[key.strip()] = int(value.strip().split()[0]) * 1024
        total = info.get("MemTotal", 0)
        available = info.get("MemAvailable", info.get("MemFree", 0))
        return total, max(0, total - available)
    except Exception:
        return 0, 0


def _loadavg() -> list[float]:
    try:
        with open("/proc/loadavg", encoding="utf-8") as f:
            parts = f.read().split()
        return [float(parts[0]), float(parts[1]), float(parts[2])]
    except Exception:
        return [0.0, 0.0, 0.0]


@router.get("")
async def system_stats(user: User = Depends(get_current_user)) -> dict:
    ram_total, ram_used = _meminfo()
    load = _loadavg()
    cpus = os.cpu_count() or 1
    cpu_pct = min(100.0, round(load[0] / cpus * 100, 1))

    target = settings.data_dir if os.path.isdir(settings.data_dir) else "/"
    try:
        du = shutil.disk_usage(target)
        disk_total, disk_used, disk_free = du.total, du.used, du.free
    except OSError:
        disk_total = disk_used = disk_free = 0

    return {
        "cpu": cpu_pct,
        "load": load,
        "cpus": cpus,
        "ram_total": ram_total,
        "ram_used": ram_used,
        "ram_pct": round(ram_used / ram_total * 100, 1) if ram_total else 0.0,
        "disk_total": disk_total,
        "disk_used": disk_used,
        "disk_free": disk_free,
        "disk_pct": round(disk_used / disk_total * 100, 1) if disk_total else 0.0,
        "quota": settings.max_user_storage,
    }
