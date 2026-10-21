"""Regression tests for prepared-answer title validation and ordering."""
from __future__ import annotations

import json
import unittest

from app.services.ready_answers import (
    _has_meaningful_query,
    _one_edit_apart,
    _parse_generation,
)


class ReadyAnswerParsingTests(unittest.TestCase):
    def _raw(self, titles: list[str]) -> str:
        return json.dumps(
            {"answer": "Проверенный ответ.", "titles": titles},
            ensure_ascii=False,
        )

    def test_original_query_is_first_and_titles_are_typo_variants(self) -> None:
        query = "Объясни рекурсию в Python"
        titles = [query, "Привет аа", "Что такое биология?", *[
            f"Формулировка {n}" for n in range(1, 13)
        ]]
        answer, parsed = _parse_generation(self._raw(titles), query, 30)

        self.assertEqual(answer, "Проверенный ответ.")
        self.assertEqual(parsed[0], query)
        self.assertGreaterEqual(len(parsed), 10)
        self.assertLessEqual(len(parsed), 30)
        self.assertEqual(len(parsed), len(set(parsed)))
        self.assertNotIn("Привет аа", parsed)
        self.assertNotIn("Что такое биология?", parsed)
        self.assertTrue(all(_one_edit_apart(query, title) for title in parsed[1:]))

    def test_duplicate_titles_are_removed(self) -> None:
        query = "Что такое API?"
        titles = [query, query, *[f"Вариант {n}" for n in range(2, 11)]]
        _, parsed = _parse_generation(self._raw(titles), query, 30)

        self.assertEqual(parsed[0], query)
        self.assertEqual(len(parsed), len(set(parsed)))

    def test_low_information_query_gets_only_exact_title(self) -> None:
        query = "ааа"
        self.assertFalse(_has_meaningful_query(query))
        malicious_or_unrelated = [query, "аааа", "привет аа", "привет"]
        _, parsed = _parse_generation(self._raw(malicious_or_unrelated), query, 30)

        self.assertEqual(parsed, [query])

    def test_typo_variants_are_generated_for_a_normal_single_word(self) -> None:
        query = "привет"
        _, parsed = _parse_generation(self._raw([query, "Как работает биология?"]), query, 10)

        self.assertEqual(parsed[0], query)
        self.assertEqual(len(parsed), 10)
        self.assertTrue(all(_one_edit_apart(query, title) for title in parsed[1:]))
        self.assertNotIn("Как работает биология?", parsed)

    def test_e_yo_spellings_are_allowed(self) -> None:
        query = "ежик и ёлка"
        _, parsed = _parse_generation(self._raw([query]), query, 30)

        self.assertEqual(parsed[0], query)
        self.assertTrue(any(
            title != query and title.casefold().replace("ё", "е") == query.casefold().replace("ё", "е")
            for title in parsed
        ))

    def test_adjacent_transposition_is_allowed_but_unrelated_text_is_not(self) -> None:
        self.assertTrue(_one_edit_apart("привет", "привеет"))  # duplicated letter
        self.assertTrue(_one_edit_apart("привет", "првиет"))   # adjacent transposition
        self.assertTrue(_one_edit_apart("ежик", "ёжик"))
        self.assertFalse(_one_edit_apart("ааа", "привет"))
        self.assertFalse(_one_edit_apart("Что такое рекурсия?", "Что такое география?"))

    def test_accepts_json_fence(self) -> None:
        query = "Что такое SQL?"
        fence = chr(96) * 3
        fenced = fence + "json\n" + self._raw([query]) + "\n" + fence

        answer, parsed = _parse_generation(fenced, query, 10)

        self.assertEqual(answer, "Проверенный ответ.")
        self.assertGreaterEqual(len(parsed), 10)
        self.assertEqual(parsed[0], query)

    def test_rejects_non_json_output(self) -> None:
        with self.assertRaisesRegex(ValueError, "не JSON"):
            _parse_generation("Я просто отвечаю текстом", "Вопрос", 30)


if __name__ == "__main__":
    unittest.main()
