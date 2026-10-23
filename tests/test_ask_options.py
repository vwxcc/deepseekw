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

    def test_extracts_quiz_with_single_and_multiple_answers(self) -> None:
        from app.ai.prompts import extract_quiz
        clean, quiz = extract_quiz(
            "Проверьте знания.\n"
            "[[quiz: Сколько будет 2 + 2? || options: 3 | 4 | 5 || correct: 4 || explanation: Сумма равна четырём. || multiple: false]]\n"
            "[[quiz: Какие из этих чисел чётные? || options: 1 | 2 | 4 || correct: 2 | 4 || explanation: Чётные числа делятся на два без остатка. || multiple: true]]"
        )
        self.assertEqual(clean, "Проверьте знания.")
        self.assertEqual(len(quiz), 2)
        self.assertEqual(quiz[0]["options"], ["3", "4", "5"])
        self.assertEqual(quiz[0]["correct"], ["4"])
        self.assertFalse(quiz[0]["multiple"])
        self.assertEqual(quiz[1]["correct"], ["2", "4"])
        self.assertTrue(quiz[1]["multiple"])
        self.assertTrue(quiz[1]["explanation"])

    def test_quiz_supports_custom_answer_without_options(self) -> None:
        from app.ai.prompts import extract_quiz
        clean, quiz = extract_quiz("[[quiz: Назовите столицу Финляндии || correct: Хельсинки || explanation: Это столица Финляндии.]]")
        self.assertEqual(clean, "")
        self.assertEqual(quiz[0]["options"], [])
        self.assertEqual(quiz[0]["correct"], ["Хельсинки"])

    def test_legacy_free_text_question(self) -> None:
        clean, questions = extract_ask("Ответ здесь. [[ask: Какой формат?]]")
        self.assertEqual(clean, "Ответ здесь.")
        self.assertEqual(questions, [{"question": "Какой формат?", "options": []}])


if __name__ == "__main__":
    unittest.main()