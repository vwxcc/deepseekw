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
    status_code = 200
    headers = {"content-type": "audio/mpeg"}
    content = b"fake-mp3-bytes"


class FakeClient:
    last_request = None

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        FakeClient.last_request = {"url": url, "headers": headers, "json": json}
        return FakeResponse()


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

    async def test_openai_compatible_audio_request(self):
        FakeClient.last_request = None
        with (
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


if __name__ == "__main__":
    unittest.main()
