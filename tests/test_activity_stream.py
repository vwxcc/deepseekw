from __future__ import annotations

import unittest

from app.ai.activity_stream import ActivityMarkupParser
from app.ai.stream_lifecycle import detach_output_drain, drain_output_until_terminal


class ActivityMarkupParserTests(unittest.TestCase):
    def test_status_and_action_markers_are_removed_from_answer(self) -> None:
        parser = ActivityMarkupParser()
        out = parser.feed(
            "Перед ответом\n[[AICH_STATUS: Составляю план]]\n"
            "[[AICH_ACTION: book|1. Читаю приложенную книгу]]\nГотово."
        )
        out += parser.finish()
        self.assertEqual(
            out,
            [
                {"kind": "text", "text": "Перед ответом\n"},
                {"kind": "status", "text": "Составляю план"},
                {"kind": "text", "text": "\n"},
                {"kind": "action", "icon": "book", "text": "1. Читаю приложенную книгу"},
                {"kind": "text", "text": "\nГотово."},
            ],
        )

    def test_marker_can_be_split_across_arbitrary_chunks(self) -> None:
        parser = ActivityMarkupParser()
        out = []
        for chunk in ("Отв", "ет: [[AICH_STA", "TUS: Проверяю ", "цифры]]", "\n42"):
            out.extend(parser.feed(chunk))
        out.extend(parser.finish())
        self.assertEqual(
            "".join(x["text"] for x in out if x["kind"] == "text"),
            "Ответ: \n42",
        )
        self.assertIn({"kind": "status", "text": "Проверяю цифры"}, out)

    def test_unknown_icon_falls_back_to_neutral_sparkle(self) -> None:
        parser = ActivityMarkupParser()
        out = parser.feed("[[AICH_ACTION: made-up-icon|Собираю результат]]")
        out += parser.finish()
        self.assertEqual(
            out,
            [{"kind": "action", "icon": "sparkle", "text": "Собираю результат"}],
        )

    def test_incomplete_control_marker_does_not_leak(self) -> None:
        parser = ActivityMarkupParser()
        out = parser.feed("Обычный текст [[AICH_ACTION: book|Читаю")
        out += parser.finish()
        self.assertEqual("".join(x.get("text", "") for x in out), "Обычный текст ")

    def test_regular_text_and_markdown_are_preserved(self) -> None:
        parser = ActivityMarkupParser()
        out = parser.feed("## Заголовок\n\n```python\nprint(2)\n```")
        out += parser.finish()
        self.assertEqual(
            "".join(x.get("text", "") for x in out),
            "## Заголовок\n\n```python\nprint(2)\n```",
        )



    def test_detached_stream_queue_is_drained_until_terminal_event(self) -> None:
        import asyncio

        async def scenario() -> None:
            queue = asyncio.Queue()
            await queue.put(("delta", "partial answer"))
            await queue.put(("ui_status", "checking"))
            await queue.put(("done", "complete answer"))
            await drain_output_until_terminal(queue)
            self.assertTrue(queue.empty())

        asyncio.run(scenario())

    def test_detached_drain_task_is_retained_and_finishes_on_error(self) -> None:
        import asyncio

        async def scenario() -> None:
            queue = asyncio.Queue()
            task = detach_output_drain(queue)
            await queue.put(("delta", "text"))
            await queue.put(("error", "provider failed"))
            await asyncio.wait_for(task, timeout=1)
            self.assertTrue(queue.empty())

        asyncio.run(scenario())

if __name__ == "__main__":
    unittest.main()
