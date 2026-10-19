from __future__ import annotations

import unittest

from app.ai.router import is_artifact_request


class ArtifactIntentTests(unittest.TestCase):
    def test_explicit_file_requests_use_one_response_artifact_flow(self) -> None:
        examples = (
            "Сделай презентацию по биологии на 8 слайдов",
            "Создай PNG-инфографику про солнечную систему",
            "Экспортируй отчёт в PDF",
            "Create a presentation about renewable energy",
            "Make a PPTX about quantum computers",
        )
        for value in examples:
            with self.subTest(value=value):
                self.assertTrue(is_artifact_request(value))

    def test_noun_first_and_shorthand_prompts_are_recognized(self) -> None:
        examples = (
            "Презентация на тему квантовых компьютеров",
            "Мне нужна таблица Excel для учёта расходов",
            "Документ: правила проекта",
            "PPTX: история интернета",
        )
        for value in examples:
            with self.subTest(value=value):
                self.assertTrue(is_artifact_request(value))

    def test_how_to_questions_and_regular_code_do_not_trigger_file_creation(self) -> None:
        examples = (
            "Как сделать презентацию в PowerPoint?",
            "Что такое PDF?",
            "Расскажи, как устроены таблицы Excel",
            "Напиши функцию Python для сортировки списка",
            "Объясни, что такое SVG",
        )
        for value in examples:
            with self.subTest(value=value):
                self.assertFalse(is_artifact_request(value))


if __name__ == "__main__":
    unittest.main()
