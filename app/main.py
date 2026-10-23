"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai.router import router as ai_router
from .ai.providers import close_provider_client, init_provider_client
from .bootstrap import bootstrap
from .config import settings
from .database import init_db
from .routers import (
    admin,
    api_v1,
    brain,
    auth,
    avatars,
    chats,
    council,
    connectors,
    files,
    github,
    limits,
    memory,
    messages,
    models,
    projects as projects_router,
    public,
    ready_answers as ready_answers_router,
    scheduled as scheduled_router,
    system,
    skills as skills_router,
)
from .services.storage import disk_free, enforce_disk_floor
from .services.ready_answers import start_ready_answer_workers, stop_ready_answer_workers

log = logging.getLogger("chatstudio")

CLEANUP_INTERVAL = 600  # seconds


def _validate_production_security() -> None:
    """Refuse an internet-facing Render startup with known-unsafe session settings."""
    on_render = bool(os.getenv("RENDER_SERVICE_ID") or os.getenv("RENDER_EXTERNAL_URL"))
    if not on_render:
        return
    secret = (settings.session_secret or "").strip()
    if secret == "dev-secret-change-me" or len(secret) < 32:
        raise RuntimeError(
            "Unsafe session configuration: set SESSION_SECRET to a random value of at least 32 characters on Render."
        )
    if not settings.session_cookie_secure:
        raise RuntimeError(
            "Unsafe session configuration: set SESSION_COOKIE_SECURE=1 for the HTTPS deployment."
        )


async def _storage_watchdog() -> None:
    """Keep the disk above the configured floor by pruning the oldest files."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL)
            try:
                await auth.cleanup_expired_guests()
            except Exception as e:
                log.warning("Guest cleanup failed: %s", e)
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
    _validate_production_security()
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s"
    )
    await init_db()
    try:
        await auth.cleanup_expired_guests()
    except Exception as e:
        log.warning("Guest cleanup failed during startup: %s", e)
    await bootstrap()
    init_provider_client()
    await ai_router.start()
    await start_ready_answer_workers()
    watchdog = asyncio.create_task(_storage_watchdog())
    try:
        yield
    finally:
        watchdog.cancel()
        try:
            await stop_ready_answer_workers()
            await ai_router.stop()
        finally:
            await close_provider_client()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.include_router(auth.router)
app.include_router(chats.router)
app.include_router(messages.router)
app.include_router(files.router)
app.include_router(models.router)
app.include_router(admin.router)
app.include_router(api_v1.router)
app.include_router(brain.router)
app.include_router(ready_answers_router.router)
app.include_router(public.router)
app.include_router(memory.router)
app.include_router(council.router)
app.include_router(avatars.router)
app.include_router(system.router)
app.include_router(limits.router)
app.include_router(github.router)
app.include_router(connectors.router)
app.include_router(skills_router.router)
app.include_router(projects_router.router)
app.include_router(scheduled_router.router)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "sandbox": {
            "enabled": bool(settings.sandbox_url),
            "state": "configured" if settings.sandbox_url else "unconfigured",
        },
    }


# --- Frontend static serving ---
_frontend = Path(settings.frontend_dir).expanduser()
if _frontend.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend)), name="assets")


@app.get("/", response_model=None)
async def index():
    idx = _frontend / "index.html"
    if idx.exists():
        # stamp the asset URLs with the real file mtimes, so a deploy can never be
        # served from the browser cache (the shell itself is always revalidated)
        try:
            stamp = str(int(max(
                (_frontend / "js" / "app.js").stat().st_mtime,
                (_frontend / "css" / "app.css").stat().st_mtime,
            )))
        except OSError:
            stamp = "0"
        html = re.sub(r"\?v=\d+", "?v=" + stamp, idx.read_text(encoding="utf-8"))
        return HTMLResponse(html, headers={"Cache-Control": "no-cache, must-revalidate"})
    return JSONResponse({"app": settings.app_name, "status": "ok"})
