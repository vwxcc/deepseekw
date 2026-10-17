from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import websearch


GOOD_RESULT = {
    "title": "Example",
    "url": "https://example.org/article",
    "snippet": "A useful snippet",
}


class FakeResponse:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeAsyncClient:
    def __init__(self, response: FakeResponse, error: Exception | None = None, **kwargs) -> None:
        self.response = response
        self.error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *args, **kwargs):
        if self.error:
            raise self.error
        return self.response


class WebSearchTests(unittest.IsolatedAsyncioTestCase):
    def test_only_http_urls_are_accepted(self) -> None:
        self.assertEqual(websearch._valid_http_url("https://example.org/a"), "https://example.org/a")
        self.assertEqual(websearch._valid_http_url("javascript:alert(1)"), "")
        self.assertEqual(websearch._valid_http_url("file:///etc/passwd"), "")
        self.assertEqual(websearch._valid_http_url("https://user:pass@example.org/"), "")

    def test_result_html_is_cleaned(self) -> None:
        row = websearch._normalise_result(
            "<b>Example &amp; Demo</b>",
            "https://example.org/",
            "<p>A useful <i>snippet</i></p>",
        )
        self.assertEqual(
            row,
            {
                "title": "Example & Demo",
                "url": "https://example.org/",
                "snippet": "A useful snippet",
            },
        )
        self.assertIsNone(websearch._normalise_result("bad", "javascript:alert(1)", "x"))

    def test_context_contains_sources(self) -> None:
        block = websearch.format_context([GOOD_RESULT])
        self.assertIn("Example", block)
        self.assertIn("https://example.org/article", block)
        self.assertIn("A useful snippet", block)

    async def test_duckduckgo_html_parser_extracts_result(self) -> None:
        page = (
            '<a class="result-link" href="https://example.org/article">'
            'Example &amp; Demo</a>'
            '<td class="result-snippet">A useful <b>snippet</b></td>'
            + (" " * 1400)
        )
        with patch.object(websearch.httpx, "AsyncClient", side_effect=lambda *a, **k: FakeAsyncClient(FakeResponse(page))):
            results = await websearch.duckduckgo_search("example", 3)
        self.assertTrue(results)
        self.assertEqual(results[0]["url"], "https://example.org/article")
        self.assertEqual(results[0]["title"], "Example & Demo")
        self.assertEqual(results[0]["snippet"], "A useful snippet")

    async def test_bing_html_parser_extracts_result(self) -> None:
        page = (
            '<ol><li class="b_algo"><h2><a href="https://example.org/article">'
            'Example &amp; Demo</a></h2><p>A useful <b>snippet</b></p></li></ol>'
            + (" " * 1400)
        )
        with patch.object(websearch.httpx, "AsyncClient", side_effect=lambda *a, **k: FakeAsyncClient(FakeResponse(page))):
            results = await websearch.bing_search("example", 3, timeout=2)
        self.assertTrue(results)
        self.assertEqual(results[0]["url"], "https://example.org/article")
        self.assertEqual(results[0]["title"], "Example & Demo")
        self.assertEqual(results[0]["snippet"], "A useful snippet")

    async def test_searxng_failure_falls_back_to_duckduckgo(self) -> None:
        broken_client = lambda *a, **k: FakeAsyncClient(
            FakeResponse(""), error=ConnectionError("SearXNG unavailable")
        )
        with (
            patch.object(websearch.settings, "searxng_url", "http://searxng.invalid"),
            patch.object(websearch.httpx, "AsyncClient", side_effect=broken_client),
            patch.object(websearch, "duckduckgo_search", new=AsyncMock(return_value=[GOOD_RESULT])),
        ):
            results = await websearch.web_search("test query", 3)
        self.assertEqual(results, [GOOD_RESULT])

    async def test_empty_duckduckgo_falls_back_to_bing(self) -> None:
        with (
            patch.object(websearch.settings, "searxng_url", ""),
            patch.object(websearch, "duckduckgo_search", new=AsyncMock(return_value=[])),
            patch.object(websearch, "bing_search", new=AsyncMock(return_value=[GOOD_RESULT])),
        ):
            results = await websearch.web_search("test query", 3)
        self.assertEqual(results, [GOOD_RESULT])


    def test_bing_image_parser_extracts_safe_image_and_source_urls(self) -> None:
        import json
        metadata = {
            "murl": "https://cdn.example.org/image.jpg",
            "turl": "https://cdn.example.org/thumb.jpg",
            "purl": "https://example.org/article",
            "t": "Example image",
            "desc": "A useful image",
        }
        page = '<a class="iusc" m="' + json.dumps(metadata).replace('"', '&quot;') + '"></a>'
        results = websearch._parse_bing_image_results(page, 3)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["kind"], "image")
        self.assertEqual(results[0]["image_url"], "https://cdn.example.org/image.jpg")
        self.assertEqual(results[0]["url"], "https://example.org/article")

    def test_bing_image_parser_rejects_non_http_urls(self) -> None:
        import json
        metadata = {
            "murl": "javascript:alert(1)",
            "turl": "https://cdn.example.org/thumb.jpg",
            "purl": "https://example.org/article",
            "t": "Unsafe image",
        }
        page = '<a class="iusc" m="' + json.dumps(metadata).replace('"', '&quot;') + '"></a>'
        self.assertEqual(websearch._parse_bing_image_results(page, 3), [])

    def test_image_context_contains_direct_image_and_source_links(self) -> None:
        image = {
            "kind": "image", "title": "Example image",
            "url": "https://example.org/article",
            "image_url": "https://cdn.example.org/image.jpg",
            "thumbnail_url": "https://cdn.example.org/thumb.jpg",
            "snippet": "A useful image",
        }
        block = websearch.format_context([image])
        self.assertIn("https://cdn.example.org/image.jpg", block)
        self.assertIn("https://example.org/article", block)
        self.assertIn("[Изображение 1]", block)


if __name__ == "__main__":
    unittest.main()
