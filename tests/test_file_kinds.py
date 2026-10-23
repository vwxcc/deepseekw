from __future__ import annotations

import unittest

from app.services.files import detect_kind


class FileKindTests(unittest.TestCase):
    def test_voice_recordings_are_recognized_as_audio(self) -> None:
        self.assertEqual(detect_kind("voice-message.webm", "audio/webm"), "audio")
        self.assertEqual(detect_kind("voice-note.m4a", "application/octet-stream"), "audio")
        self.assertEqual(detect_kind("recording.mp3", "audio/mpeg"), "audio")

    def test_audio_detection_does_not_override_images_or_documents(self) -> None:
        self.assertEqual(detect_kind("photo.png", "image/png"), "image")
        self.assertEqual(detect_kind("notes.txt", "text/plain"), "text")


if __name__ == "__main__":
    unittest.main()
