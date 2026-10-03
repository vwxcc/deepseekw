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
    """Direct DuckDuckGo Lite search — used when SearXNG has no working engines."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    html = ""
    for url in (
        "https://lite.duckduckgo.com/lite/?q=" + urllib.parse.quote(query),
        "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query),
    ):
        try:
            async with httpx.AsyncClient(
                timeout=settings.web_search_timeout, follow_redirects=True, headers=headers
            ) as client:
                resp = await client.get(url)
                if resp.status_code < 400 and len(resp.text) > 2000:
                    html = resp.text
                    log.info("DDG answered %s (%d bytes)", url.split("/")[2], len(html))
                    break
        except Exception as e:  # noqa: BLE001
            log.warning("DuckDuckGo fallback failed on %s: %s", url.split("/")[2], e)

    if not html:
        return []

    snippets = [
        _clean_text(x) for x in re.findall(
            r'class="result-snippet"[^>]*>(.*?)</td>', html, re.S
        )
    ]

    out: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(r"<a\b([^>]*)>(.*?)</a>", html, re.S):
        attrs, text = m.group(1), _clean_text(m.group(2))
        if "result-link" not in attrs:
            continue
        href = re.search(r'href=["\']([^"\']+)', attrs)
        if not href:
            continue
        url = _unwrap(href.group(1))
        if not url.startswith("http") or url in seen:
            continue
        seen.add(url)
        out.append(
            {
                "title": text[:200] or url,
                "url": url,
                "snippet": (snippets[len(out)] if len(out) < len(snippets) else "")[:500],
            }
        )
        if len(out) >= count:
            break
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
