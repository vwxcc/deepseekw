from datetime import timedelta
import unittest

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import AudioGeneration, Chat, Message, MessageStatus, Role, User, utcnow
from app.services.audio_quota import (
    AudioQuotaExceeded,
    release_audio_generation,
    reserve_audio_generation,
)


class AudioQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.db = factory()

        self.user = User(
            email="audio-quota@example.test",
            password_hash="not-a-real-password",
            plan="free",
        )
        self.db.add(self.user)
        await self.db.flush()
        chat = Chat(user_id=self.user.id, title="Quota test")
        self.db.add(chat)
        await self.db.flush()

        self.message_ids = []
        for _ in range(8):
            message = Message(
                chat_id=chat.id,
                role=Role.assistant,
                content="Test response",
                status=MessageStatus.completed,
            )
            self.db.add(message)
            await self.db.flush()
            self.message_ids.append(message.id)
        await self.db.commit()

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    async def test_free_and_pro_each_allow_four_generations_per_window(self):
        for plan in ("free", "pro"):
            await self.db.execute(delete(AudioGeneration))
            await self.db.commit()

            for message_id in self.message_ids[:4]:
                await reserve_audio_generation(
                    self.db, self.user.id, message_id, plan
                )

            with self.assertRaises(AudioQuotaExceeded) as raised:
                await reserve_audio_generation(
                    self.db, self.user.id, self.message_ids[4], plan
                )
            self.assertEqual(raised.exception.limit, 4)
            self.assertEqual(raised.exception.hours, 5)
            self.assertEqual(raised.exception.used, 4)

    async def test_expired_generations_do_not_consume_current_window(self):
        old = AudioGeneration(
            user_id=self.user.id,
            message_id=self.message_ids[0],
            created_at=utcnow() - timedelta(hours=6),
        )
        self.db.add(old)
        await self.db.commit()

        await reserve_audio_generation(
            self.db, self.user.id, self.message_ids[1], "free"
        )
        remaining = await self.db.scalar(
            select(AudioGeneration).where(
                AudioGeneration.user_id == self.user.id
            )
        )
        self.assertIsNotNone(remaining)
        self.assertGreaterEqual(remaining.created_at, utcnow() - timedelta(hours=5))

    async def test_failed_generation_can_return_its_reserved_slot(self):
        reservations = []
        for message_id in self.message_ids[:4]:
            reservations.append(
                await reserve_audio_generation(
                    self.db, self.user.id, message_id, "free"
                )
            )
        with self.assertRaises(AudioQuotaExceeded):
            await reserve_audio_generation(
                self.db, self.user.id, self.message_ids[4], "free"
            )

        await release_audio_generation(self.db, reservations[0])
        replacement = await reserve_audio_generation(
            self.db, self.user.id, self.message_ids[4], "free"
        )
        self.assertIsNotNone(replacement)


if __name__ == "__main__":
    unittest.main()
