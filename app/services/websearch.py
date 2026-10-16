"""Best-effort public web search with SearXNG, DuckDuckGo and Bing fallbacks."""
from __future__ import annotations

import asyncio
import html
import logging
import re
import urllib.parse
from urllib.parse import urlsplit

import httpx

from ..config import settings

log = logging.getLogger("chatstudio.search")

_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _clean_text(raw: str) -> str:
    raw = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def _valid_http_url(value: str) -> str:
    value = html.unescape((value or "").strip())
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            return ""
        if parsed.username or parsed.password:
            return ""
        return value
    except ValueError:
        return ""


def _normalise_result(title: str, url: str, snippet: str) -> dict | None:
    safe_url = _valid_http_url(url)
    if not safe_url:
        return None
    return {
        "title": _clean_text(title)[:200] or safe_url,
        "url": safe_url,
        "snippet": _clean_text(snippet)[:500],
    }


async def web_search(query: str, limit: int | None = None) -> list[dict]:
    """Return search results; a failing optional SearXNG must not disable search."""
    query = (query or "").strip()
    if not settings.web_search_enabled or not query:
        return []

    count = max(1, min(int(limit or settings.web_search_results or 5), 10))
    total_timeout = max(3, min(int(settings.web_search_timeout or 8), 15))
    deadline = asyncio.get_running_loop().time() + total_timeout

    # SearXNG is optional. Never burn the whole request timeout on a stale
    # Docker-only hostname before trying an Internet-accessible fallback.
    base = (settings.searxng_url or "").rstrip("/")
    if base:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining > 0.25:
            try:
                async with httpx.AsyncClient(
                    timeout=min(2.5, remaining),
                    follow_redirects=True,
                    headers={"User-Agent": _USER_AGENT},
                ) as client:
                    resp = await client.get(
                        f"{base}/search",
                        params={
                            "q": query,
                            "format": "json",
                            "language": "ru",
                            "safesearch": "0",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                out = []
                for item in (data.get("results") or []):
                    result = _normalise_result(
                        item.get("title") or item.get("url") or "",
                        item.get("url") or "",
                        item.get("content") or "",
                    )
                    if result:
                        out.append(result)
                    if len(out) >= count:
                        break
                if out:
                    return out
                log.info("SearXNG returned no usable results; trying public fallbacks")
            except Exception as e:  # network-dependent by design
                log.warning("SearXNG unavailable; using public fallback: %s", type(e).__name__)

    remaining = deadline - asyncio.get_running_loop().time()
    # Reserve part of the total time budget for a second provider instead of
    # letting a stalled DuckDuckGo request consume the whole search window.
    ddg_timeout = min(remaining, max(1.5, min(4.5, remaining * 0.55)))
    if ddg_timeout > 0.25:
        try:
            results = await asyncio.wait_for(
                duckduckgo_search(query, count),
                timeout=ddg_timeout,
            )
            if results:
                log.info("DuckDuckGo returned %d results", len(results))
                return results[:count]
        except Exception as e:  # includes wait_for timeout
            log.warning("DuckDuckGo search unavailable: %s", type(e).__name__)

    remaining = deadline - asyncio.get_running_loop().time()
    if remaining > 0.25:
        try:
            results = await asyncio.wait_for(
                bing_search(query, count, timeout=remaining),
                timeout=remaining,
            )
            if results:
                log.info("Bing returned %d results", len(results))
                return results[:count]
        except Exception as e:  # includes wait_for timeout
            log.warning("Bing search unavailable: %s", type(e).__name__)

    log.warning("All search providers returned no results")
    return []


def _unwrap(href: str) -> str:
    href = html.unescape(href or "")
    parsed = urlsplit(href)
    if "duckduckgo.com" in (parsed.netloc or ""):
        target = urllib.parse.parse_qs(parsed.query).get("uddg")
        if target:
            return urllib.parse.unquote(target[0])
    if href.startswith("//"):
        return "https:" + href
    return href


async def duckduckgo_search(query: str, count: int) -> list[dict]:
    """DuckDuckGo Lite/HTML fallback used when SearXNG is absent or failing."""
    headers = {
        "User-Agent": _USER_AGENT,
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    source = ""
    for url in (
        "https://lite.duckduckgo.com/lite/?q=" + urllib.parse.quote(query),
        "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query),
    ):
        try:
            async with httpx.AsyncClient(
                timeout=min(max(2, settings.web_search_timeout), 8),
                follow_redirects=True,
                headers=headers,
            ) as client:
                resp = await client.get(url)
                if resp.status_code < 400 and len(resp.text) > 1200:
                    source = resp.text
                    break
        except Exception as e:
            log.debug("DuckDuckGo endpoint failed (%s)", type(e).__name__)

    if not source:
        return []

    snippets = [
        _clean_text(x) for x in re.findall(
            r'class=["\\']result-snippet["\\'][^>]*>(.*?)</td>',
            source,
            re.S | re.I,
        )
    ]
    out: list[dict] = []
    seen: set[str] = set()
    for match in re.finditer(r"<a\b([^>]*)>(.*?)</a>", source, re.S | re.I):
        attrs, title = match.group(1), _clean_text(match.group(2))
        if "result-link" not in attrs:
            continue
        href = re.search(r"""href=["']([^"']+)""", attrs, re.I)
        if not href:
            continue
        url = _valid_http_url(_unwrap(href.group(1)))
        if not url or url in seen:
            continue
        seen.add(url)
        result = _normalise_result(
            title,
            url,
            snippets[len(out)] if len(out) < len(snippets) else "",
        )
        if result:
            out.append(result)
        if len(out) >= count:
            break
    return out


async def bing_search(query: str, count: int, timeout: float = 5) -> list[dict]:
    """Bing HTML fallback; no API key is required, but the provider may rate-limit."""
    url = "https://www.bing.com/search?" + urllib.parse.urlencode(
        {"q": query, "setlang": "ru", "cc": "ru"}
    )
    headers = {
        "User-Agent": _USER_AGENT,
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            timeout=max(1, min(float(timeout), 8)),
            follow_redirects=True,
            headers=headers,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            source = resp.text
    except Exception as e:
        log.debug("Bing endpoint failed (%s)", type(e).__name__)
        return []

    out: list[dict] = []
    seen: set[str] = set()
    # Search result cards are marked with b_algo. Each is parsed independently
    # so navigation links and unrelated page links are not offered as results.
    blocks = re.findall(
        r"""<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>(.*?)(?=<li\b[^>]*class=["'][^"']*\bb_algo\b|</ol>)""",
        source,
        re.S | re.I,
    )
    for block in blocks:
        match = re.search(
            r"""<h2[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>""",
            block,
            re.S | re.I,
        )
        if not match:
            continue
        result_url = _valid_http_url(match.group(1))
        if not result_url or result_url in seen:
            continue
        seen.add(result_url)
        snippet_match = re.search(r"<p[^>]*>(.*?)</p>", block, re.S | re.I)
        result = _normalise_result(
            match.group(2),
            result_url,
            snippet_match.group(1) if snippet_match else "",
        )
        if result:
            out.append(result)
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
    for i, result in enumerate(results, 1):
        lines.append(f"[{i}] {result['title']}")
        lines.append(f"    URL: {result['url']}")
        if result["snippet"]:
            lines.append(f"    {result['snippet']}")
    return "\n".join(lines)
