from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.ai import provider_config


class PrimaryProviderEnvironmentTests(unittest.TestCase):
    def test_explicit_provider_url_key_and_model_id_override_database(self) -> None:
        configured = SimpleNamespace(
            model_fields_set={
                "qwen_provider", "qwen_base_url", "qwen_api_key",
                "qwen_model_id", "qwen_model",
            },
            qwen_provider=" openai-compatible ",
            qwen_base_url=" https://api.other-provider.example/v1/ ",
            qwen_api_key=" new-secret ",
            qwen_model_id=" vendor/external-model-id ",
            qwen_model="legacy-model",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "openai", "https://old-provider.example/v1", "old-secret", "old-model"
            )

        self.assertEqual(
            result,
            (
                "openai-compatible",
                "https://api.other-provider.example/v1",
                "new-secret",
                "vendor/external-model-id",
            ),
        )

    def test_legacy_qwen_model_remains_supported(self) -> None:
        configured = SimpleNamespace(
            model_fields_set={"qwen_model"},
            qwen_provider="openai",
            qwen_base_url="https://llm.stage.satel.org/v1",
            qwen_api_key="",
            qwen_model_id="",
            qwen_model="legacy-model-id",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "saved-provider", "https://saved-provider.example/v1",
                "saved-secret", "saved-model"
            )

        self.assertEqual(result, (
            "saved-provider", "https://saved-provider.example/v1",
            "saved-secret", "legacy-model-id",
        ))

    def test_omitted_environment_values_preserve_database_settings(self) -> None:
        configured = SimpleNamespace(
            model_fields_set=set(),
            qwen_provider="openai",
            qwen_base_url="https://llm.stage.satel.org/v1",
            qwen_api_key="",
            qwen_model_id="",
            qwen_model="qwen36-35b",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "saved-provider", "https://saved-provider.example/v1",
                "saved-secret", "saved-model"
            )

        self.assertEqual(result, (
            "saved-provider", "https://saved-provider.example/v1",
            "saved-secret", "saved-model",
        ))

    def test_empty_values_do_not_erase_saved_model_fields(self) -> None:
        configured = SimpleNamespace(
            model_fields_set={
                "qwen_provider", "qwen_base_url", "qwen_api_key",
                "qwen_model_id", "qwen_model",
            },
            qwen_provider="",
            qwen_base_url="",
            qwen_api_key="",
            qwen_model_id="",
            qwen_model="",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "saved-provider", "https://saved-provider.example/v1",
                "saved-secret", "saved-model"
            )

        self.assertEqual(result, (
            "saved-provider", "https://saved-provider.example/v1",
            "saved-secret", "saved-model",
        ))

    def test_each_nonempty_environment_value_overrides_independently(self) -> None:
        configured = SimpleNamespace(
            model_fields_set={"qwen_provider", "qwen_base_url", "qwen_model_id"},
            qwen_provider="compatible",
            qwen_base_url="https://api.other-provider.example/v1/",
            qwen_api_key="",
            qwen_model_id="new-model",
            qwen_model="qwen36-35b",
        )
        with patch.object(provider_config, "settings", configured):
            result = provider_config.apply_primary_provider_overrides(
                "saved-provider", "https://saved-provider.example/v1",
                "saved-secret", "saved-model"
            )

        self.assertEqual(result, (
            "compatible", "https://api.other-provider.example/v1",
            "saved-secret", "new-model",
        ))


if __name__ == "__main__":
    unittest.main()
