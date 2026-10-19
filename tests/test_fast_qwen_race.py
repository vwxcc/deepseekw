from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.ai.router import (
    AIRouter,
    FAST_QWEN_DECLINE_MARKER,
    FAST_QWEN_SYSTEM_PROMPT,
    EntryConfig,
    Job,
)
from app.models import RouteType


def model_entry(identifier: str, model: str) -> EntryConfig:
    return EntryConfig(
        id=identifier,
        model_set_id=identifier,
        provider="openai",
        base_url="https://provider.example/v1",
        api_key="test-key",
        model=model,
        temperature=0.2,
        max_tokens=32000,
        timeout=10,
    )


def message_job(user_text: str = "Explain binary search") -> Job:
    return Job(
        kind="message",
        route_type=RouteType.MAIN,
        chat_id="test-chat",
        message_id="test-message",
        user_id="test-user",
        user_text=user_text,
        history_messages=[{"role": "user", "content": user_text}],
    )


class FastQwenPromptTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_is_capped_and_prompt_is_appended_to_system(self) -> None:
        router = AIRouter(concurrency=1)
        fast = model_entry("fast-qwen-automatic", "qwen36-35b")
        fast.max_tokens = 16000
        messages = [
            {"role": "system", "content": "Base system rules"},
            {"role": "user", "content": "Explain binary search briefly"},
        ]

        with patch(
            "app.ai.router.complete_chat_with_usage",
            new=AsyncMock(return_value=("A short answer.", {"completion_tokens": 12})),
        ) as completion:
            result = await router._fast_qwen_once(fast, messages)

        self.assertEqual(completion.await_args.kwargs["max_tokens"], 8000)
        sent_messages = completion.await_args.kwargs["messages"]
        self.assertIn("Base system rules", sent_messages[0]["content"])
        self.assertIn(FAST_QWEN_DECLINE_MARKER, sent_messages[0]["content"])
        self.assertIn("8000", FAST_QWEN_SYSTEM_PROMPT)
        self.assertEqual(result, ("A short answer.", {"completion_tokens": 12}, True))
        # Never mutate the shared primary-model history in place.
        self.assertEqual(messages[0]["content"], "Base system rules")

    async def test_decline_marker_is_never_an_accepted_answer(self) -> None:
        router = AIRouter(concurrency=1)
        fast = model_entry("fast-qwen-automatic", "qwen36-35b")
        usage = {"prompt_tokens": 20, "completion_tokens": 1}
        with patch(
            "app.ai.router.complete_chat_with_usage",
            new=AsyncMock(return_value=(FAST_QWEN_DECLINE_MARKER, usage)),
        ):
            result = await router._fast_qwen_once(
                fast, [{"role": "user", "content": "Do a large research task"}]
            )
        self.assertEqual(result, (FAST_QWEN_DECLINE_MARKER, usage, False))


class AutomaticModelRaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.router = AIRouter(concurrency=1)
        self.primary = model_entry("primary-entry", "main-model")
        self.fast = model_entry("fast-qwen-automatic", "qwen36-35b")
        self.job = message_job()
        self.router._bill = AsyncMock()

    async def test_primary_wins_when_its_complete_answer_finishes_first(self) -> None:
        async def primary(*args, **kwargs):
            await asyncio.sleep(0.01)
            return ("Primary answer.", "", {"completion_tokens": 20})

        async def fast(*args, **kwargs):
            await asyncio.sleep(0.2)
            return ("Quick answer.", {"completion_tokens": 5}, True)

        with (
            patch.object(self.router, "_stream_once", new=primary),
            patch.object(self.router, "_fast_qwen_once", new=fast),
        ):
            result = await self.router._race_primary_and_fast(
                self.job, self.primary, self.fast, [{"role": "user", "content": "Hi"}]
            )

        self.assertEqual(result[0], ("Primary answer.", "", {"completion_tokens": 20}))
        self.assertIs(result[1], self.primary)
        self.router._bill.assert_not_awaited()

    async def test_primary_winner_keeps_its_interactive_ui_events(self) -> None:
        async def primary(*args, **kwargs):
            await asyncio.sleep(0.01)
            kwargs["deferred_events"].append(
                ("ui_action", '{"icon": "check-circle", "text": "Проверить ответ"}')
            )
            return ("Primary answer.", "", {"completion_tokens": 20})

        async def fast(*args, **kwargs):
            await asyncio.sleep(0.2)
            return ("Quick answer.", {"completion_tokens": 5}, True)

        with (
            patch.object(self.router, "_stream_once", new=primary),
            patch.object(self.router, "_fast_qwen_once", new=fast),
        ):
            result = await self.router._race_primary_and_fast(
                self.job, self.primary, self.fast, [{"role": "user", "content": "Hi"}]
            )

        self.assertIs(result[1], self.primary)
        self.assertEqual(
            await self.job.output.get(),
            ("ui_action", '{"icon": "check-circle", "text": "Проверить ответ"}'),
        )

    async def test_fast_qwen_wins_when_it_finishes_first(self) -> None:
        async def primary(*args, **kwargs):
            await asyncio.sleep(0.2)
            return ("Primary answer.", "", {"completion_tokens": 20})

        async def fast(*args, **kwargs):
            await asyncio.sleep(0.01)
            return ("Quick answer.", {"completion_tokens": 5}, True)

        with (
            patch.object(self.router, "_stream_once", new=primary),
            patch.object(self.router, "_fast_qwen_once", new=fast),
        ):
            result = await self.router._race_primary_and_fast(
                self.job, self.primary, self.fast, [{"role": "user", "content": "Hi"}]
            )

        self.assertEqual(result[0], ("Quick answer.", "", {"completion_tokens": 5}))
        self.assertIs(result[1], self.fast)
        self.router._bill.assert_not_awaited()

    async def test_declined_fast_call_is_ignored_but_its_usage_is_accounted(self) -> None:
        fast_usage = {"prompt_tokens": 30, "completion_tokens": 1}

        async def primary(*args, **kwargs):
            await asyncio.sleep(0.03)
            return ("Primary answer.", "", {"prompt_tokens": 40, "completion_tokens": 20})

        async def fast(*args, **kwargs):
            return (FAST_QWEN_DECLINE_MARKER, fast_usage, False)

        with (
            patch.object(self.router, "_stream_once", new=primary),
            patch.object(self.router, "_fast_qwen_once", new=fast),
        ):
            result = await self.router._race_primary_and_fast(
                self.job, self.primary, self.fast, [{"role": "user", "content": "Hi"}]
            )

        self.assertEqual(result[0][0], "Primary answer.")
        self.assertIs(result[1], self.primary)
        self.router._bill.assert_awaited_once_with(
            self.job, self.fast, fast_usage, "fast_qwen_race_lost"
        )

    async def test_fast_response_cannot_win_a_file_creation_request(self) -> None:
        self.job.user_text = "Создай презентацию о космосе"
        fast_usage = {"prompt_tokens": 30, "completion_tokens": 50}

        async def primary(*args, **kwargs):
            await asyncio.sleep(0.03)
            return ("Primary artifact answer.", "", {"prompt_tokens": 40, "completion_tokens": 20})

        async def fast(*args, **kwargs):
            return ("Here is a brief answer.", fast_usage, True)

        with (
            patch.object(self.router, "_stream_once", new=primary),
            patch.object(self.router, "_fast_qwen_once", new=fast),
        ):
            result = await self.router._race_primary_and_fast(
                self.job, self.primary, self.fast, [{"role": "user", "content": self.job.user_text}]
            )

        self.assertEqual(result[0][0], "Primary artifact answer.")
        self.assertIs(result[1], self.primary)
        self.router._bill.assert_awaited_once_with(
            self.job, self.fast, fast_usage, "fast_qwen_race_lost"
        )


if __name__ == "__main__":
    unittest.main()
