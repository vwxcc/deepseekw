from __future__ import annotations

import json
import unittest

from app.ai.prompts import (
    ToolCommandStreamFilter,
    extract_tool_commands,
    strip_tool_commands,
)


class ToolCommandParsingTests(unittest.TestCase):
    def test_github_update_command_preserves_braces_and_closing_brackets_in_code(self) -> None:
        code = (
            "const settings = { nested: { enabled: true } };\n"
            "const marker = ']]';\n"
            "function run() { return { ok: true }; }"
        )
        payload = {
            "provider": "github",
            "action": "update_file",
            "repo": "owner/repo",
            "path": "frontend/app.js",
            "content": code,
            "message": "Update UI",
            "sha": "existing-sha",
        }
        source = "Before the command.\n[[AICH_CONNECTOR: " + json.dumps(payload) + "]]\nAfter the command."
        commands = extract_tool_commands(source)
        self.assertEqual(commands, [("CONNECTOR", payload)])
        clean = strip_tool_commands(source)
        self.assertNotIn("[[AICH_CONNECTOR:", clean)
        self.assertIn("Before the command.", clean)
        self.assertIn("After the command.", clean)

    def test_web_search_command_is_parsed_and_removed(self) -> None:
        source = (
            'Поищу сейчас. [[AICH_WEB_SEARCH: {"query":"weather in Helsinki 2026"}]] '
            "Затем подведу итог."
        )
        self.assertEqual(
            extract_tool_commands(source),
            [("WEB_SEARCH", {"query": "weather in Helsinki 2026"})],
        )
        self.assertNotIn("AICH_WEB_SEARCH", strip_tool_commands(source))

    def test_stream_filter_hides_a_command_split_across_chunks(self) -> None:
        payload = {
            "provider": "github",
            "action": "update_file",
            "content": "const value = { a: true }; const closer = ']]';",
        }
        encoded = json.dumps(payload)
        chunks = [
            "Ответ перед командой. [[AICH_CONNEC",
            "TOR: " + encoded[:20],
            encoded[20:] + "]] Окончание ответа.",
        ]
        command_filter = ToolCommandStreamFilter()
        visible = "".join(command_filter.feed(chunk) for chunk in chunks) + command_filter.finish()
        self.assertIn("Ответ перед командой.", visible)
        self.assertIn("Окончание ответа.", visible)
        self.assertNotIn("AICH_CONNECTOR", visible)
        self.assertNotIn('"content"', visible)

    def test_unclosed_command_is_not_executed(self) -> None:
        source = 'До маркера [[AICH_CONNECTOR: {"provider":"github","action":"list_repositories"}'
        self.assertEqual(extract_tool_commands(source), [])
        command_filter = ToolCommandStreamFilter()
        visible = command_filter.feed(source) + command_filter.finish()
        self.assertIn("До маркера", visible)
        self.assertNotIn("AICH_CONNECTOR", visible)


if __name__ == "__main__":
    unittest.main()
