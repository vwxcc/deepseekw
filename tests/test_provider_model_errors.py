from __future__ import annotations

import unittest

from app.ai.providers import _format_http_error, is_model_unavailable_error


class ProviderModelErrorTests(unittest.TestCase):
    def test_distributor_model_not_found_has_actionable_configuration_guidance(self) -> None:
        body = (
            '{"error":{"code":"model_not_found",'
            '"message":"No available channel for model qwen36-35b under group default '
            '(distributor) (request id: request-123)","type":"new_api_error"}}'
        )

        message = _format_http_error(503, body, "qwen36-35b")

        self.assertIn("HTTP 503", message)
        self.assertIn("qwen36-35b", message)
        self.assertIn("QWEN_MODEL_ID", message)
        self.assertIn("QWEN_BASE_URL", message)
        self.assertIn("request id: request-123", message)
        self.assertTrue(is_model_unavailable_error(message))

    def test_transient_provider_error_keeps_original_details(self) -> None:
        body = '{"error":{"code":"overloaded","message":"upstream overloaded"}}'

        message = _format_http_error(503, body, "example-model")

        self.assertEqual(message, f"HTTP 503: {body}")
        self.assertFalse(is_model_unavailable_error(message))

    def test_detects_channel_error_even_when_error_code_is_missing(self) -> None:
        self.assertTrue(
            is_model_unavailable_error(
                "No available channel for model example-model under group default"
            )
        )


if __name__ == "__main__":
    unittest.main()
