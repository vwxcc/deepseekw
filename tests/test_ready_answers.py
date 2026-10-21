"""Regression tests for prepared-answer title validation and ordering."""
from __future__ import annotations

import json
import unittest

from app.services.ready_answers import (
    _has_meaningful_query,
    _normalise_title,
    _one_edit_apart,
    _parse_generation,
    _title_is_related,
)


class ReadyAnswerParsingTests(unittest.TestCase):
    def _raw(self, titles: list[str]) -> str:
        return json.dumps(
            {"answer": "Проверенный ответ.", "titles": titles},
            ensure_ascii=False,
        )

    def test_original_query_is_first_titles_are_lowercase_and_relevant(self) -> None:
        query = "Объясни рекурсию в Python"
        titles = [
            query,
            "Привет аа",
            "Что такое биология?",
            "как объяснить рекурсию на python",
            '"Объясни рекурсию в Python"',
            "Объясни рекурсию, в Python",
        ]
        answer, parsed = _parse_generation(self._raw(titles), query, 30)

        self.assertEqual(answer, "Проверенный ответ.")
        self.assertEqual(parsed[0], _normalise_title(query))
        self.assertGreaterEqual(len(parsed), 10)
        self.assertLessEqual(len(parsed), 30)
        self.assertEqual(len(parsed), len(set(parsed)))
        self.assertTrue(all(title == title.casefold() for title in parsed))
        self.assertNotIn("привет аа", parsed)
        self.assertNotIn("что такое биология?", parsed)
        self.assertTrue(all(_title_is_related(query, title) for title in parsed))

    def test_duplicate_titles_are_removed_case_insensitively(self) -> None:
        query = "Что такое API?"
        titles = [query, query.lower(), "ЧТО ТАКОЕ API?", *[
            f"вариант {n}" for n in range(2, 11)
        ]]
        _, parsed = _parse_generation(self._raw(titles), query, 30)

        self.assertEqual(parsed[0], _normalise_title(query))
        self.assertEqual(len(parsed), len(set(parsed)))

    def test_low_information_query_gets_only_lowercase_exact_title(self) -> None:
        query = "ААА"
        self.assertFalse(_has_meaningful_query(query))
        malicious_or_unrelated = [query, "аааа", "привет аа", "привет"]
        _, parsed = _parse_generation(self._raw(malicious_or_unrelated), query, 500)

        self.assertEqual(parsed, ["ааа"])

    def test_meaningful_single_word_gets_related_synonyms_or_typos(self) -> None:
        query = "привет"
        _, parsed = _parse_generation(
            self._raw([query, "как работает биология?", "здравствуйте", "привте"]),
            query, 30,
        )

        self.assertEqual(parsed[0], "привет")
        self.assertLessEqual(len(parsed), 30)
        self.assertTrue(all(title == title.casefold() for title in parsed))
        self.assertNotIn("как работает биология?", parsed)
        self.assertTrue(all(_title_is_related(query, title) for title in parsed))
        self.assertIn("здравствуйте", parsed)

    def test_e_yo_spellings_are_allowed(self) -> None:
        query = "Ежик и ёлка"
        _, parsed = _parse_generation(self._raw([query]), query, 30)

        self.assertEqual(parsed[0], _normalise_title(query))
        self.assertTrue(any(
            title != _normalise_title(query)
            and title.replace("ё", "е") == _normalise_title(query).replace("ё", "е")
            for title in parsed
        ))

    def test_adjacent_transposition_and_casefold(self) -> None:
        self.assertTrue(_one_edit_apart("привет", "привеет"))
        self.assertTrue(_one_edit_apart("привет", "првиет"))
        self.assertTrue(_one_edit_apart("ежик", "ёжик"))
        self.assertFalse(_one_edit_apart("ааа", "привет"))
        self.assertFalse(_title_is_related("Что такое рекурсия?", "Что такое география?"))

    def test_recognized_language_alias_must_not_change_subject(self) -> None:
        self.assertTrue(_title_is_related("как работает python", "как работает питон"))
        self.assertFalse(_title_is_related("как работает python", "как работает java"))
        self.assertTrue(_title_is_related("deepseek api", "дипсик api"))

    def test_lowercase_alias_and_punctuation_variants(self) -> None:
        query = "Как работает Python"
        _, parsed = _parse_generation(
            self._raw([query, "как работает питон", '"как работает python"', "как работает java"]),
            query,
            500,
        )

        self.assertEqual(parsed[0], "как работает python")
        self.assertTrue(all(title == title.casefold() for title in parsed))
        self.assertIn("как работает питон", parsed)
        self.assertIn('"как работает python"', parsed)
        self.assertNotIn("как работает java", parsed)
        self.assertLessEqual(len(parsed), 500)

    def test_title_count_accepts_500_limit(self) -> None:
        query = "Объясни рекурсию в Python"
        variants = [f"объясни рекурсию на python вариант {n}" for n in range(1, 501)]
        _, parsed = _parse_generation(self._raw([query, *variants]), query, 500)

        self.assertEqual(parsed[0], _normalise_title(query))
        self.assertLessEqual(len(parsed), 500)
        self.assertEqual(len(parsed), len(set(parsed)))
        self.assertTrue(all(title == title.casefold() for title in parsed))

    def test_accepts_json_fence(self) -> None:
        query = "Что такое SQL?"
        fence = chr(96) * 3
        fenced = fence + "json\n" + self._raw([query]) + "\n" + fence

        answer, parsed = _parse_generation(fenced, query, 10)

        self.assertEqual(answer, "Проверенный ответ.")
        self.assertGreaterEqual(len(parsed), 10)
        self.assertEqual(parsed[0], _normalise_title(query))

    def test_user_query_normalization_is_unicode_lowercase(self) -> None:
        self.assertEqual(_normalise_title("ПРИВЕТ МОЙ МИР"), "привет мой мир")
        self.assertEqual(_normalise_title("ЁЖИК"), "ёжик")

    def test_rejects_non_json_output(self) -> None:
        with self.assertRaisesRegex(ValueError, "не JSON"):
            _parse_generation("Я просто отвечаю текстом", "Вопрос", 30)


if __name__ == "__main__":
    unittest.main()
