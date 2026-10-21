"""Regression tests for AI response timing and latency optimisations."""
from __future__ import annotations

import unittest

from app.ai.router import (
    EntryConfig,
    Job,
    RouteType,
    _job_wants_web_search,
    _log_job_timing,
    _response_cache_key,
)


class AILatencyOptimizationTests(unittest.TestCase):
    def make_job(self, text: str, **kwargs) -> Job:
        return Job(
            kind="message",
            route_type=RouteType.MAIN,
            chat_id="chat-test",
            user_id="user-test",
            user_text=text,
            search_query=text,
            history_messages=[{"role": "user", "content": text}],
            first_exchange=True,
            **kwargs,
        )

    def make_entry(self) -> EntryConfig:
        return EntryConfig(
            id="entry-test",
            model_set_id="set-test",
            provider="openai",
            base_url="https://example.com/v1",
            api_key="unused-test-key",
            model="test-model",
            temperature=0.2,
            max_tokens=2000,
            timeout=30,
        )

    def test_ordinary_question_does_not_start_search(self) -> None:
        self.assertFalse(_job_wants_web_search(
            self.make_job("Объясни рекурсию в Python простым примером")
        ))

    def test_current_weather_and_explicit_url_start_search(self) -> None:
        self.assertTrue(_job_wants_web_search(self.make_job("Какая сегодня погода в Казани?")))
        self.assertTrue(_job_wants_web_search(self.make_job("Прочитай страницу https://example.com/guide")))

    def test_search_quick_action_prompt_itself_does_not_search(self) -> None:
        prompt = (
            "**Поиск.** Что именно найти? Сформулируйте вопрос — "
            "я поищу в интернете и дам ответ со ссылками на источники."
        )
        self.assertFalse(_job_wants_web_search(self.make_job(prompt)))

    def test_search_quick_action_followup_does_search(self) -> None:
        job = self.make_job("История Древнего Египта")
        job.history_messages = [
            {"role": "user", "content": (
                "**Поиск.** Что именно найти? Сформулируйте вопрос — "
                "я поищу в интернете и дам ответ со ссылками на источники."
            )},
            {"role": "assistant", "content": "Что именно нужно найти?"},
            {"role": "user", "content": "История Древнего Египта"},
        ]
        self.assertTrue(_job_wants_web_search(job))

    def test_cache_key_ignores_only_the_current_time_instruction_timestamp(self) -> None:
        query = "Объясни рекурсию в Python простым примером"
        job = self.make_job(query)
        entry = self.make_entry()
        first = [
            {"role": "system", "content":
             "Для относительных дат используй текущее локальное время: 2026-10-21 14:10 EEST"},
            {"role": "user", "content": query},
        ]
        second = [
            {"role": "system", "content":
             "Для относительных дат используй текущее локальное время: 2026-10-21 14:11 EEST"},
            {"role": "user", "content": query},
        ]
        self.assertEqual(_response_cache_key(job, entry, first), _response_cache_key(job, entry, second))

    def test_cache_rejects_date_sensitive_prompts(self) -> None:
        job = self.make_job("Сколько дней до Нового года?")
        self.assertIsNone(_response_cache_key(
            job, self.make_entry(),
            [{"role": "system", "content": "system"},
             {"role": "user", "content": job.user_text}],
        ))

    def test_timing_log_contains_durations_but_no_private_prompt(self) -> None:
        job = self.make_job("PRIVATE_PROMPT_MUST_NOT_APPEAR_IN_LOGS")
        job.message_id = "abcdef1234567890"
        job.enqueued_at = 100.0
        job.dequeued_at = 100.025
        job.preparation_ms = 250.0
        job.search_ms = 10.0
        job.generation_started_at = 100.4
        job.first_token_at = 100.8
        with self.assertLogs("chatstudio.ai", level="INFO") as captured:
            _log_job_timing(job, now=101.25)
        output = "\n".join(captured.output)
        for expected in (
            "queue_ms=25.0",
            "preparation_ms=250.0",
            "search_ms=10.0",
            "first_token_ms=800.0",
            "provider_ttft_ms=400.0",
            "total_ms=1250.0",
            "cache_hit=False",
            "message=abcdef12",
        ):
            self.assertIn(expected, output)
        self.assertNotIn("PRIVATE_PROMPT_MUST_NOT_APPEAR_IN_LOGS", output)
        self.assertNotIn("user-test", output)


if __name__ == "__main__":
    unittest.main()
