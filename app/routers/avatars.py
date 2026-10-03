"""Avatar endpoint — public SVGs so they can be used straight in <img>."""
from __future__ import annotations

from fastapi import APIRouter, Response

from ..services.avatars import AVATAR_COUNT, avatar_svg

router = APIRouter(prefix="/api/avatars", tags=["avatars"])

CACHE = "public, max-age=86400"


@router.get("/{index}.svg")
async def get_avatar(index: int, size: int = 96) -> Response:
    size = max(24, min(size, 256))
    return Response(
        content=avatar_svg(index, size),
        media_type="image/svg+xml",
        headers={"Cache-Control": CACHE},
    )


@router.get("")
async def list_avatars() -> dict:
    return {"count": AVATAR_COUNT}
