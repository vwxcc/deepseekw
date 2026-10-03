"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai.router import router as ai_router
from .bootstrap import bootstrap
from .config import settings
from .database import init_db
from .routers import (
    admin,
    auth,
    avatars,
    chats,
    council,
    files,
    github,
    limits,
    memory,
    messages,
    models,
    posts,
    public,
    system,
)
from .services.storage import disk_free, enforce_disk_floor

log = logging.getLogger("chatstudio")

CLEANUP_INTERVAL = 600  # seconds


async def _storage_watchdog() -> None:
    """Keep the disk above the configured floor by pruning the oldest files."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL)
            free = disk_free()
            if free < settings.disk_min_free:
                log.warning(
                    "Low disk space (%.2f GB free) — pruning old files",
                    free / (1024 ** 3),
                )
                await enforce_disk_floor()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # pragma: no cover
            log.warning("Storage watchdog error: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s"
    )
    await init_db()
    await bootstrap()
    await ai_router.start()
    watchdog = asyncio.create_task(_storage_watchdog())
    try:
        yield
    finally:
        watchdog.cancel()
        await ai_router.stop()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.include_router(auth.router)
app.include_router(chats.router)
app.include_router(messages.router)
app.include_router(files.router)
app.include_router(models.router)
app.include_router(admin.router)
app.include_router(public.router)
app.include_router(memory.router)
app.include_router(council.router)
app.include_router(posts.router)
app.include_router(avatars.router)
app.include_router(system.router)
app.include_router(limits.router)
app.include_router(github.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "version": settings.app_version}


# --- Frontend static serving ---
_frontend = Path(settings.frontend_dir).expanduser()
if _frontend.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend)), name="assets")


@app.get("/", response_model=None)
async def index():
    idx = _frontend / "index.html"
    if idx.exists():
        # never let the shell HTML go stale in the browser
        return FileResponse(idx, headers={"Cache-Control": "no-cache, must-revalidate"})
    return JSONResponse({"app": settings.app_name, "status": "ok"})
