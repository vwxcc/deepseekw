import unittest

from app.services.audio_state import (
    AudioGenerationInProgress,
    active_audio_generation,
    begin_audio_generation,
    finish_audio_generation,
)


class AudioGenerationStateTests(unittest.TestCase):
    def tearDown(self):
        for user_id in ("audio-state-user", "audio-state-other"):
            message_id = active_audio_generation(user_id)
            if message_id:
                finish_audio_generation(user_id, message_id)

    def test_rejects_parallel_generation_for_the_same_user(self):
        begin_audio_generation("audio-state-user", "message-one")
        with self.assertRaises(AudioGenerationInProgress) as raised:
            begin_audio_generation("audio-state-user", "message-two")
        self.assertEqual(raised.exception.message_id, "message-one")
        self.assertEqual(active_audio_generation("audio-state-user"), "message-one")

    def test_different_users_can_generate_independently(self):
        begin_audio_generation("audio-state-user", "message-one")
        begin_audio_generation("audio-state-other", "message-two")
        self.assertEqual(active_audio_generation("audio-state-user"), "message-one")
        self.assertEqual(active_audio_generation("audio-state-other"), "message-two")

    def test_finishing_only_clears_the_matching_generation(self):
        begin_audio_generation("audio-state-user", "message-one")
        finish_audio_generation("audio-state-user", "message-other")
        self.assertEqual(active_audio_generation("audio-state-user"), "message-one")
        finish_audio_generation("audio-state-user", "message-one")
        self.assertIsNone(active_audio_generation("audio-state-user"))


if __name__ == "__main__":
    unittest.main()
