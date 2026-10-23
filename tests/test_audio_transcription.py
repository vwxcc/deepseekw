from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.ai.providers import ProviderError, transcribe_audio


class AudioTranscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_transcribes_using_openai_compatible_v1_endpoint(self) -> None:
        response = Mock(status_code=200, text='{"text":"  Привет, AI CH!  "}')
        response.json.return_value = {"text": "  Привет, AI CH!  "}
        client = Mock()
        client.post = AsyncMock(return_value=response)

        with patch("app.ai.providers._get_provider_client", return_value=client):
            text = await transcribe_audio(
                data=b"fake audio",
                filename="voice-message.webm",
                mime_type="audio/webm",
                base_url="https://api.example.test/v1/",
                api_key="test-key",
                model="whisper-1",
            )

        self.assertEqual(text, "Привет, AI CH!")
        args, kwargs = client.post.call_args
        self.assertEqual(args[0], "https://api.example.test/v1/audio/transcriptions")
        self.assertEqual(kwargs["headers"], {"Authorization": "Bearer test-key"})
        self.assertEqual(kwargs["data"]["model"], "whisper-1")
        self.assertEqual(kwargs["files"]["file"][0], "voice-message.webm")
        self.assertEqual(kwargs["files"]["file"][2], "audio/webm")

    async def test_reports_provider_failure_instead_of_faking_transcription(self) -> None:
        response = Mock(status_code=404, text='{"error":"not supported"}')
        client = Mock()
        client.post = AsyncMock(return_value=response)

        with patch("app.ai.providers._get_provider_client", return_value=client):
            with self.assertRaisesRegex(ProviderError, "HTTP 404"):
                await transcribe_audio(
                    data=b"fake audio",
                    filename="voice-message.webm",
                    mime_type="audio/webm",
                    base_url="https://api.example.test",
                    api_key="",
                )


if __name__ == "__main__":
    unittest.main()
