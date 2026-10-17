from __future__ import annotations

import unittest

from app.ai.prompts import skills_for


class BundledSkillTests(unittest.TestCase):
    def test_loads_essay_skill_for_essay_request(self) -> None:
        prompt = skills_for("Помоги написать сочинение по литературе")
        self.assertIn("Специализированный навык: essays", prompt)
        self.assertIn("конкретный тезис", prompt)
        self.assertNotIn("Специализированный навык: drawing", prompt)

    def test_loads_blueprint_skill_for_technical_drawing(self) -> None:
        prompt = skills_for("Сделай технический чертёж детали с размерами")
        self.assertIn("Специализированный навык: blueprints", prompt)
        self.assertIn("единицы", prompt)

    def test_loads_drawing_and_humanizing_skills_independently(self) -> None:
        drawing = skills_for("Нарисуй SVG-иллюстрацию")
        humanize = skills_for("Очеловечь этот текст, сохрани смысл")
        self.assertIn("Специализированный навык: drawing", drawing)
        self.assertIn("Специализированный навык: humanize-text", humanize)
        self.assertNotIn("Специализированный навык: essays", humanize)

    def test_irrelevant_request_does_not_load_skills(self) -> None:
        self.assertEqual(skills_for("Объясни, что такое интеграл"), "")


if __name__ == "__main__":
    unittest.main()
