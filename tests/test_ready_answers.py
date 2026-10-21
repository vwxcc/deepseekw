"""Regression tests for prepared-answer title validation and ordering."""
from __future__ import annotations

import json
import unittest

from app.services.ready_answers import _parse_generation


class ReadyAnswerParsingTests(unittest.TestCase):
    def _raw(self, titles: list[str]) -> str:
        return json.dumps(
            {"answer": "Проверенный ответ.", "titles": titles},
            ensure_ascii=False,
        )

    def test_original_query_is_first_even_when_model_puts_it_last(self) -> None:
        query = "Объясни рекурсию в Python"
        titles = [f"Формулировка {n}" for n in range(1, 13)] + [query]
        answer, parsed = _parse_generation(self._raw(titles), query, 10)

        self.assertEqual(answer, "Проверенный ответ.")
        self.assertEqual(parsed[0], query)
        self.assertEqual(len(parsed), 10)
        self.assertEqual(len(set(parsed)), 10)

    def test_duplicate_titles_are_removed(self) -> None:
        query = "Что такое API?"
        titles = [query, "Что такое API?", *[f"Вариант {n}" for n in range(2, 11)]]
        _, parsed = _parse_generation(self._raw(titles), query, 30)

        self.assertEqual(parsed[0], query)
        self.assertEqual(len(parsed), len(set(parsed)))

    def test_requires_at_least_ten_unique_titles(self) -> None:
        query = "Объясни алгоритм"
        titles = [query, *[f"Вариант {n}" for n in range(2, 9)]]

        with self.assertRaisesRegex(ValueError, "не менее 10"):
            _parse_generation(self._raw(titles), query, 30)

    def test_accepts_json_fence(self) -> None:
        query = "Что такое SQL?"
        titles = [query, *[f"Заголовок {n}" for n in range(2, 11)]]
        fence = chr(96) * 3
        fenced = fence + "json\n" + self._raw(titles) + "\n" + fence

        answer, parsed = _parse_generation(fenced, query, 10)

        self.assertEqual(answer, "Проверенный ответ.")
        self.assertEqual(len(parsed), 10)

    def test_rejects_non_json_output(self) -> None:
        with self.assertRaisesRegex(ValueError, "не JSON"):
            _parse_generation("Я просто отвечаю текстом", "Вопрос", 30)


if __name__ == "__main__":
    unittest.main()
