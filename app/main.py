"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai.router import router as ai_router
from .bootstrap import bootstrap
from .config import settings
from .database import init_db
from .routers import auth, chats, files, messages


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await bootstrap()
    await ai_router.start()
    try:
        yield
    finally:
        await ai_router.stop()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.include_router(auth.router)
app.include_router(chats.router)
app.include_router(messages.router)
app.include_router(files.router)


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
        return FileResponse(idx)
    return JSONResponse({"app": settings.app_name, "status": "ok"})
