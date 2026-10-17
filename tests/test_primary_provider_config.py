from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.ai import provider_config


class PrimaryProviderEnvironmentTests(unittest.TestCase):
    def test_explicit_base_url_and_api_key_override_database(self) -> None:
        configured = SimpleNamespace(
            model_fields_set={"qwen_base_url", "qwen_api_key"},
            qwen_base_url=" https://api.other-provider.example/v1/ ",
            qwen_api_key=" new-secret ",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "https://old-provider.example/v1", "old-secret"
            )

        self.assertEqual(
            result,
            ("https://api.other-provider.example/v1", "new-secret"),
        )

    def test_omitted_environment_values_preserve_database_settings(self) -> None:
        # Defaults may be present in Settings, but must not override an existing
        # model entry unless the corresponding environment/.env field was set.
        configured = SimpleNamespace(
            model_fields_set=set(),
            qwen_base_url="https://llm.stage.satel.org/v1",
            qwen_api_key="",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "https://saved-provider.example/v1", "saved-secret"
            )

        self.assertEqual(
            result,
            ("https://saved-provider.example/v1", "saved-secret"),
        )

    def test_each_nonempty_environment_value_overrides_independently(self) -> None:
        configured = SimpleNamespace(
            model_fields_set={"qwen_base_url", "qwen_api_key"},
            qwen_base_url="https://api.other-provider.example/v1/",
            qwen_api_key="",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "https://saved-provider.example/v1", "saved-secret"
            )

        self.assertEqual(
            result,
            ("https://api.other-provider.example/v1", "saved-secret"),
        )


if __name__ == "__main__":
    unittest.main()
