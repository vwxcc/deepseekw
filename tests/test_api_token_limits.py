"""Regression checks for API token estimation and per-key prepaid limits."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.routers.api_v1 import _endpoint, _reserve_tokens, _usage_counts


class ApiTokenAccountingTests(unittest.TestCase):
    def test_endpoint_appends_chat_completions_once(self):
        self.assertEqual(_endpoint("https://provider.example/v1"), "https://provider.example/v1/chat/completions")
        self.assertEqual(_endpoint("https://provider.example"), "https://provider.example/v1/chat/completions")

    def test_reported_usage_and_cached_tokens_are_clamped(self):
        tin, tout, cached = _usage_counts(
            {"prompt_tokens": 20, "completion_tokens": 7,
             "prompt_tokens_details": {"cached_tokens": 40}},
            {"messages": [{"role": "user", "content": "hello"}]},
        )
        self.assertEqual((tin, tout, cached), (20, 7, 20))

    def test_usage_falls_back_when_provider_does_not_report_tokens(self):
        tin, tout, cached = _usage_counts(
            {}, {"messages": [{"role": "user", "content": "hello"}]}, "answer text"
        )
        self.assertGreater(tin, 0)
        self.assertGreater(tout, 0)
        self.assertEqual(cached, 0)


class _Result:
    def __init__(self, row=None, rowcount=1):
        self.row = row
        self.rowcount = rowcount

    def one_or_none(self):
        return self.row


class ApiTokenReservationTests(unittest.IsolatedAsyncioTestCase):
    async def test_reservation_is_capped_by_wallet_and_key(self):
        db = SimpleNamespace(
            scalar=AsyncMock(return_value=500),
            execute=AsyncMock(side_effect=[
                _Result((600, 0, 0, 1000, True)),
                _Result(rowcount=1),
                _Result(rowcount=1),
            ]),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )
        user = SimpleNamespace(id="user-1")
        key = SimpleNamespace(id="key-1")
        payload = {
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 1500,
        }

        forwarded, reserved = await _reserve_tokens(db, user, key, payload)

        self.assertGreater(reserved, 0)
        self.assertLessEqual(reserved, 500)
        self.assertLessEqual(reserved, 600)
        self.assertLessEqual(forwarded["max_tokens"], 1000)
        self.assertEqual(forwarded["model"], "ai-ch")
        db.commit.assert_awaited_once()

    async def test_no_upstream_reservation_when_wallet_cannot_cover_input(self):
        db = SimpleNamespace(
            scalar=AsyncMock(return_value=1),
            execute=AsyncMock(return_value=_Result((1000, 0, 0, 512, True))),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )
        with self.assertRaises(HTTPException) as raised:
            await _reserve_tokens(
                db,
                SimpleNamespace(id="user-1"),
                SimpleNamespace(id="key-1"),
                {"messages": [{"role": "user", "content": "hello"}]},
            )
        self.assertEqual(raised.exception.status_code, 402)
        db.commit.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
