"""Web search through a local SearXNG instance."""
from __future__ import annotations

import logging

import httpx

from ..config import settings

log = logging.getLogger("chatstudio.search")


async def web_search(query: str, limit: int | None = None) -> list[dict]:
    """Return [{title, url, snippet}] from SearXNG (best effort, never raises)."""
    query = (query or "").strip()
    if not settings.web_search_enabled or not query:
        return []

    base = (settings.searxng_url or "").rstrip("/")
    if not base:
        return []

    params = {
        "q": query,
        "format": "json",
        "language": "ru",
        "safesearch": "0",
    }
    try:
        async with httpx.AsyncClient(timeout=settings.web_search_timeout) as client:
            resp = await client.get(f"{base}/search", params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:  # pragma: no cover - network dependent
        log.warning("Web search failed: %s", e)
        return []

    count = limit or settings.web_search_results
    out: list[dict] = []
    for item in (data.get("results") or [])[:count]:
        url = (item.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "title": (item.get("title") or url).strip()[:200],
                "url": url,
                "snippet": (item.get("content") or "").strip()[:500],
            }
        )
    return out


def format_context(results: list[dict]) -> str:
    """Render search results as a context block for the model."""
    if not results:
        return ""
    lines = [
        "Ниже — актуальные результаты поиска в интернете. "
        "Используй их как источник фактов и ссылайся на URL.",
        "",
    ]
    for i, r in enumerate(results, 1):
        lines.append(f"[{i}] {r['title']}")
        lines.append(f"    URL: {r['url']}")
        if r["snippet"]:
            lines.append(f"    {r['snippet']}")
    return "\n".join(lines)
