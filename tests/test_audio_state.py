import unittest
from datetime import timedelta

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import (
    AudioGenerationLock,
    Chat,
    Message,
    MessageStatus,
    Role,
    User,
    utcnow,
)
from app.services.audio_state import (
    AudioGenerationInProgress,
    active_audio_generation,
    begin_audio_generation,
    claim_shared_audio_generation,
    finish_audio_generation,
    finish_shared_audio_generation,
    shared_active_audio_generation,
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



class SharedAudioGenerationLockTests(unittest.IsolatedAsyncioTestCase):
    """The shared lock must remain authoritative across sessions/workers."""

    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.db1 = factory()
        self.db2 = factory()

        self.user = User(
            email="audio-lock@example.test",
            password_hash="not-a-real-password",
            plan="free",
        )
        self.db1.add(self.user)
        await self.db1.flush()
        self.user_id = self.user.id
        chat = Chat(user_id=self.user_id, title="Audio lock test")
        self.db1.add(chat)
        await self.db1.flush()
        self.message_ids = []
        for _ in range(2):
            message = Message(
                chat_id=chat.id,
                role=Role.assistant,
                content="Test response",
                status=MessageStatus.completed,
            )
            self.db1.add(message)
            await self.db1.flush()
            self.message_ids.append(message.id)
        await self.db1.commit()

    async def asyncTearDown(self):
        await self.db1.close()
        await self.db2.close()
        await self.engine.dispose()

    async def test_lock_is_visible_and_rejects_second_session(self):
        first, second = self.message_ids
        await claim_shared_audio_generation(self.db1, self.user_id, first)

        self.assertEqual(
            await shared_active_audio_generation(self.db2, self.user_id), first
        )
        with self.assertRaises(AudioGenerationInProgress) as raised:
            await claim_shared_audio_generation(self.db2, self.user_id, second)
        self.assertEqual(raised.exception.message_id, first)

        await finish_shared_audio_generation(self.db1, self.user_id, first)
        # The second session may still cache the lock it read before the delete.
        self.db2.expire_all()
        await claim_shared_audio_generation(self.db2, self.user_id, second)
        self.db1.expire_all()
        self.assertEqual(
            await shared_active_audio_generation(self.db1, self.user_id), second
        )

    async def test_release_only_removes_the_matching_generation(self):
        first, second = self.message_ids
        await claim_shared_audio_generation(self.db1, self.user_id, first)
        await finish_shared_audio_generation(self.db2, self.user_id, second)
        self.assertEqual(
            await shared_active_audio_generation(self.db2, self.user_id), first
        )
        await finish_shared_audio_generation(self.db1, self.user_id, first)
        self.db2.expire_all()
        self.assertIsNone(
            await shared_active_audio_generation(self.db2, self.user_id)
        )

    async def test_expired_lock_is_cleaned_and_does_not_block_new_generation(self):
        first, second = self.message_ids
        self.db1.add(
            AudioGenerationLock(
                user_id=self.user_id,
                message_id=first,
                created_at=utcnow() - timedelta(minutes=31),
            )
        )
        await self.db1.commit()

        self.assertIsNone(
            await shared_active_audio_generation(self.db2, self.user_id)
        )
        await claim_shared_audio_generation(self.db2, self.user_id, second)
        self.db1.expire_all()
        self.assertEqual(
            await shared_active_audio_generation(self.db1, self.user_id), second
        )


if __name__ == "__main__":
    unittest.main()
