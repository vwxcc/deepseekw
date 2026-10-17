import unittest

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import Chat, Memory, User
from app.routers.messages import _memory_block


class ChatScopedMemoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.session_factory() as db:
            db.add(User(
                id="memory-test-user",
                email="memory-test@example.invalid",
                password_hash="test-hash",
            ))
            await db.commit()
            db.add_all([
                Chat(id="memory-chat-a", user_id="memory-test-user", title="A"),
                Chat(id="memory-chat-b", user_id="memory-test-user", title="B"),
                Memory(
                    user_id="memory-test-user",
                    content="Global preferred style",
                    kind="preference",
                ),
                Memory(
                    user_id="memory-test-user",
                    content="Fact from chat A",
                    kind="fact",
                    chat_id="memory-chat-a",
                    message_id="memory-message-a",
                ),
                Memory(
                    user_id="memory-test-user",
                    content="Preference for chat A",
                    kind="preference",
                    chat_id="memory-chat-a",
                    message_id="memory-message-pref-a",
                ),
                Memory(
                    user_id="memory-test-user",
                    content="Private fact from chat B",
                    kind="fact",
                    chat_id="memory-chat-b",
                    message_id="memory-message-b",
                ),
            ])
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_only_global_and_same_chat_memories_are_injected(self):
        async with self.session_factory() as db:
            prompt = await _memory_block(db, "memory-test-user", "memory-chat-a")

        self.assertIn("Global preferred style", prompt)
        self.assertIn("Fact from chat A", prompt)
        self.assertIn("Preference for chat A", prompt)
        self.assertNotIn("Private fact from chat B", prompt)

    async def test_other_chat_memories_are_not_injected(self):
        async with self.session_factory() as db:
            prompt = await _memory_block(db, "memory-test-user", "memory-chat-b")

        self.assertIn("Private fact from chat B", prompt)
        self.assertNotIn("Fact from chat A", prompt)
        self.assertNotIn("Preference for chat A", prompt)


if __name__ == "__main__":
    unittest.main()
