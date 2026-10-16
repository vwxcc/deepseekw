import unittest
from unittest.mock import patch

from app.config import settings
from app.services.tts import (
    TTSNotConfiguredError,
    audio_file_path,
    clean_tts_text,
    generate_speech,
    normalized_audio_format,
)


class FakeResponse:
    def __init__(self, url):
        self.status_code = 200
        if url.endswith("/chat/completions"):
            self.headers = {"content-type": "application/json"}
            self.content = b'{"choices":[{"message":{"content":"\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440."}}]}'
        else:
            self.headers = {"content-type": "audio/mpeg"}
            self.content = b"fake-mp3-bytes"

    def json(self):
        import json
        return json.loads(self.content)


class FakeClient:
    last_request = None
    requests = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        request = {"url": url, "headers": headers, "json": json}
        FakeClient.last_request = request
        FakeClient.requests.append(request)
        return FakeResponse(url)


class TextToSpeechTests(unittest.IsolatedAsyncioTestCase):
    def test_clean_text_removes_ui_markers_urls_and_markdown(self):
        cleaned = clean_tts_text(
            "## **Привет, мир!**\n[[ask: Уточни?]] Документация: https://example.com/page"
        )
        self.assertIn("Привет, мир!", cleaned)
        self.assertNotIn("[[ask:", cleaned)
        self.assertNotIn("https://", cleaned)
        self.assertNotIn("##", cleaned)

    def test_code_blocks_are_not_read_verbatim(self):
        cleaned = clean_tts_text("До кода\n```python\nprint('secret')\n```\nПосле кода")
        self.assertIn("Фрагмент кода пропущен", cleaned)
        self.assertNotIn("print(", cleaned)
        self.assertIn("После кода", cleaned)

    def test_text_is_bounded(self):
        cleaned = clean_tts_text("слово " * 1000, max_chars=100)
        self.assertLessEqual(len(cleaned), 101)

    def test_supported_audio_formats(self):
        for fmt in ("mp3", "opus", "aac", "flac", "wav", "pcm"):
            with patch.object(settings, "tts_response_format", fmt):
                self.assertEqual(normalized_audio_format(), fmt)
        with patch.object(settings, "tts_response_format", "exe"):
            with self.assertRaises(ValueError):
                normalized_audio_format()

    def test_audio_path_does_not_expose_user_input(self):
        path = audio_file_path("../private/user", "../../message", "mp3")
        self.assertEqual(path.suffix, ".mp3")
        self.assertNotIn("private", str(path))
        self.assertNotIn("message", path.name)
        self.assertEqual(len(path.stem), 40)

    async def test_missing_base_url_is_reported_before_network_request(self):
        with patch.object(settings, "tts_base_url", ""):
            with self.assertRaises(TTSNotConfiguredError):
                await generate_speech("Проверка")

    async def test_non_ascii_preprocess_api_key_fails_with_actionable_config_error(self):
        with (
            patch.object(settings, "tts_preprocess_base_url", "https://prep.example/v1"),
            patch.object(settings, "tts_preprocess_api_key", "ключ-с-кириллицей"),
            patch.object(settings, "tts_preprocess_model", "verbalizer"),
            patch("app.services.tts.httpx.AsyncClient", FakeClient) as client,
        ):
            with self.assertRaises(TTSNotConfiguredError) as raised:
                await generate_speech("Проверка")
        self.assertIn("TTS_PREPROCESS_API_KEY", str(raised.exception))
        client.assert_not_called()

    async def test_non_ascii_tts_api_key_fails_with_actionable_config_error(self):
        with (
            patch.object(settings, "tts_base_url", "https://speech.example/v1"),
            patch.object(settings, "tts_api_key", "ключ-с-кириллицей"),
            patch.object(settings, "tts_preprocess_base_url", "https://prep.example/v1"),
            patch.object(settings, "tts_preprocess_api_key", "valid-ascii-token"),
            patch.object(settings, "tts_preprocess_model", "verbalizer"),
            patch("app.services.tts.httpx.AsyncClient", FakeClient) as client,
        ):
            with self.assertRaises(TTSNotConfiguredError) as raised:
                await generate_speech("Проверка")
        self.assertIn("TTS_API_KEY", str(raised.exception))
        client.assert_not_called()

    async def test_openai_compatible_audio_request(self):
        FakeClient.last_request = None
        FakeClient.requests = []
        with (
            patch.object(settings, "tts_preprocess_base_url", "https://prep.example/v1"),
            patch.object(settings, "tts_preprocess_api_key", "prep-secret"),
            patch.object(settings, "tts_preprocess_model", "verbalizer"),
            patch.object(settings, "tts_preprocess_temperature", 0.1),
            patch.object(settings, "tts_preprocess_max_tokens", 12000),
            patch.object(settings, "tts_preprocess_timeout", 180),
            patch.object(settings, "tts_base_url", "https://speech.example/v1"),
            patch.object(settings, "tts_api_key", "test-secret"),
            patch.object(settings, "tts_model", "voice-model"),
            patch.object(settings, "tts_voice", "ru-RU"),
            patch.object(settings, "tts_response_format", "mp3"),
            patch("app.services.tts.httpx.AsyncClient", FakeClient),
        ):
            audio, fmt = await generate_speech("Привет, **мир**.")
        self.assertEqual(audio, b"fake-mp3-bytes")
        self.assertEqual(fmt, "mp3")
        request = FakeClient.last_request
        self.assertEqual(request["url"], "https://speech.example/v1/audio/speech")
        self.assertEqual(request["headers"]["Authorization"], "Bearer test-secret")
        self.assertEqual(request["json"]["model"], "voice-model")
        self.assertEqual(request["json"]["voice"], "ru-RU")
        self.assertEqual(request["json"]["input"], "Привет, мир.")
        self.assertEqual(request["json"]["response_format"], "mp3")
        self.assertEqual(len(FakeClient.requests), 2)
        prep_request = FakeClient.requests[0]
        self.assertEqual(prep_request["url"], "https://prep.example/v1/chat/completions")
        self.assertEqual(prep_request["headers"]["Authorization"], "Bearer prep-secret")
        self.assertEqual(prep_request["json"]["model"], "verbalizer")
        self.assertIn("Привет, **мир**.", prep_request["json"]["messages"][1]["content"])


if __name__ == "__main__":
    unittest.main()
