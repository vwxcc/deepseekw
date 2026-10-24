"""Regression tests for file-prefetch all-or-nothing behavior."""
from __future__ import annotations

import time
import unittest

from app.routers import prefetch


class PrefetchContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_store = dict(prefetch._store)
        prefetch._store.clear()

    def tearDown(self) -> None:
        prefetch._store.clear()
        prefetch._store.update(self.original_store)

    def add_job(
        self, job_id: str, *, file_id: str, user_id: str = "user-1",
        status: str = "READY", result: str = "processed"
    ) -> None:
        prefetch._store[job_id] = {
            "user_id": user_id,
            "file_id": file_id,
            "filename": file_id,
            "status": status,
            "started_at": time.time(),
            "result": result,
        }

    def test_all_ready_matching_files_return_prepared_context(self) -> None:
        self.add_job("p1", file_id="f1", result="first text")
        self.add_job("p2", file_id="f2", result="second text")

        result = prefetch.get_ready_prefetch_context("user-1", ["p1", "p2"], ["f1", "f2"])

        self.assertEqual(
            result,
            "[Файл: f1]\\nfirst text\\n\\n---\\n\\n[Файл: f2]\\nsecond text",
        )

    def test_missing_or_unready_job_falls_back_for_every_file(self) -> None:
        self.add_job("p1", file_id="f1", result="first text")
        self.add_job("p2", file_id="f2", status="PROCESSING", result="")

        self.assertIsNone(
            prefetch.get_ready_prefetch_context("user-1", ["p1", "p2"], ["f1", "f2"])
        )

    def test_wrong_owner_cannot_use_another_users_prefetch(self) -> None:
        self.add_job("p1", file_id="f1", user_id="someone-else")

        self.assertIsNone(prefetch.get_ready_prefetch_context("user-1", ["p1"], ["f1"]))

    def test_prefetch_ids_must_match_exact_attachment_set(self) -> None:
        self.add_job("p1", file_id="f1")
        self.add_job("p2", file_id="f2")

        self.assertIsNone(prefetch.get_ready_prefetch_context("user-1", ["p1"], ["f1", "f2"]))
        self.assertIsNone(prefetch.get_ready_prefetch_context("user-1", ["p1", "p2"], ["f1", "other"]))
        self.assertIsNone(prefetch.get_ready_prefetch_context("user-1", ["p1", "p1"], ["f1", "f1"]))

    def test_admin_disable_cancels_ready_and_running_jobs(self) -> None:
        self.add_job("ready", file_id="f1", status="READY")
        self.add_job("running", file_id="f2", status="PROCESSING")
        self.add_job("failed", file_id="f3", status="FAILED")

        prefetch.cancel_all_prefetches()

        self.assertEqual(prefetch._store["ready"]["status"], "CANCELLED")
        self.assertEqual(prefetch._store["running"]["status"], "CANCELLED")
        self.assertEqual(prefetch._store["failed"]["status"], "FAILED")


if __name__ == "__main__":
    unittest.main()
