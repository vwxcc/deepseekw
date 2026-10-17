from __future__ import annotations

import unittest

from app.ai.prompts import extract_ask


class AskOptionsTests(unittest.TestCase):
    def test_extracts_multiple_choice_and_free_text_questions(self) -> None:
        clean, questions = extract_ask(
            "Перед вопросами.\n"
            "[[ask: Какой стиль? || options: Деловой | Минимализм | Яркий]]\n"
            "[[ask: Какая аудитория?]]"
        )
        self.assertEqual(clean, "Перед вопросами.")
        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0], {
            "question": "Какой стиль?", "options": ["Деловой", "Минимализм", "Яркий"],
        })
        self.assertEqual(questions[1], {"question": "Какая аудитория?", "options": []})

    def test_limits_questions_and_ignores_single_option(self) -> None:
        markers = "\n".join(f"[[ask: Вопрос {i}? || options: Только один]]" for i in range(8))
        _, questions = extract_ask(markers)
        self.assertEqual(len(questions), 6)
        self.assertEqual(questions[0]["options"], [])

    def test_legacy_free_text_question(self) -> None:
        clean, questions = extract_ask("Ответ здесь. [[ask: Какой формат?]]")
        self.assertEqual(clean, "Ответ здесь.")
        self.assertEqual(questions, [{"question": "Какой формат?", "options": []}])


if __name__ == "__main__":
    unittest.main()
