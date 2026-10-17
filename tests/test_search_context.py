import unittest

from app.routers.messages import _search_context


class SearchContextTests(unittest.TestCase):
    def test_context_prioritises_latest_query_and_keeps_referents(self):
        history = [
            {"role": "user", "content": "Расскажи про Pyodide и его ограничения."},
            {"role": "assistant", "content": "Pyodide запускает Python в браузере через WebAssembly."},
            {"role": "user", "content": "А какие есть альтернативы?"},
        ]

        context = _search_context(history, "А какие есть альтернативы?")

        self.assertTrue(context.startswith("Последний запрос пользователя: А какие есть альтернативы?"))
        self.assertIn("Pyodide", context)
        self.assertIn("Пользователь: Расскажи про Pyodide", context)

    def test_context_is_bounded_and_handles_empty_history(self):
        context = _search_context([], "Найди документацию FastAPI")

        self.assertEqual(context, "Последний запрос пользователя: Найди документацию FastAPI")
        self.assertLessEqual(len(_search_context([{"role": "assistant", "content": "x" * 9000}], "y")), 3500)

    def test_ignores_non_conversational_history_entries(self):
        context = _search_context(
            [
                {"role": "tool", "content": "secret tool output"},
                {"role": "assistant", "content": "Тема связана с Python."},
            ],
            "Найди актуальную документацию",
        )

        self.assertIn("Тема связана с Python", context)
        self.assertNotIn("secret tool output", context)


if __name__ == "__main__":
    unittest.main()
