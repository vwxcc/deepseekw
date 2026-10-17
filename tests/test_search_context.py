import unittest

from app.services.search_context import _plan_search_queries, _search_context


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

    def test_explicit_none_prevents_fallback_search(self):
        self.assertEqual(
            _plan_search_queries(" NONE\\n", "Последний запрос пользователя: посчитай 2 + 2"),
            [],
        )

    def test_fallback_removes_context_labels_and_keeps_subject(self):
        queries = _plan_search_queries(
            "",
            "Последний запрос пользователя: А какие есть альтернативы?\\n"
            "Пользователь: Pyodide работает в браузере",
        )
        self.assertEqual(queries, ["альтернативы pyodide браузере"])

    def test_planner_numbered_lines_are_parsed_as_separate_queries(self):
        self.assertEqual(
            _plan_search_queries("1. Pyodide alternatives\\n2. Python in browser", ""),
            ["Pyodide alternatives", "Python in browser"],
        )


if __name__ == "__main__":
    unittest.main()
