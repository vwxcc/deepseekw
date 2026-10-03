"""Web search through a local SearXNG instance."""
from __future__ import annotations

import logging
import re
import urllib.parse

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
    if not out:
        alt = await duckduckgo_search(query, count)
        if alt:
            log.info("SearXNG empty -> DuckDuckGo gave %d results", len(alt))
        return alt
    return out



def _clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", raw or "")).strip()


def _unwrap(href: str) -> str:
    m = re.search(r"uddg=([^&]+)", href or "")
    if m:
        return urllib.parse.unquote(m.group(1))
    return href if (href or "").startswith("http") else ""


async def duckduckgo_search(query: str, count: int) -> list[dict]:
    """Direct DuckDuckGo HTML search — used when SearXNG has no working engines."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            timeout=settings.web_search_timeout, follow_redirects=True, headers=headers
        ) as client:
            resp = await client.post(
                "https://html.duckduckgo.com/html/", data={"q": query, "kl": "ru-ru"}
            )
            resp.raise_for_status()
            html = resp.text
    except Exception as e:  # noqa: BLE001
        log.warning("DuckDuckGo fallback failed: %s", e)
        return []

    titles = re.findall(
        r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.S
    )
    snippets = re.findall(
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', html, re.S
    )
    out: list[dict] = []
    for i, (href, title) in enumerate(titles[:count]):
        url = _unwrap(href)
        if not url:
            continue
        out.append(
            {
                "title": _clean_text(title)[:200] or url,
                "url": url,
                "snippet": _clean_text(snippets[i])[:500] if i < len(snippets) else "",
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
