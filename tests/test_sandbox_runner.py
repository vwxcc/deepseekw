from __future__ import annotations

import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import Settings
from sandbox import server


class SandboxRunnerTests(unittest.TestCase):
    def test_legacy_disable_env_is_not_a_server_execution_gate(self) -> None:
        with patch.dict(os.environ, {"RUN_SANDBOX_ENABLED": "0"}, clear=False):
            config = Settings(_env_file=None)

        self.assertFalse(hasattr(config, "run_sandbox_enabled"))
        router_path = Path(__file__).resolve().parents[1] / "app" / "ai" / "router.py"
        router_source = router_path.read_text(encoding="utf-8")
        self.assertNotIn("run_sandbox_enabled", router_source)

    @unittest.skipUnless(
        hasattr(os, "geteuid") and os.geteuid() == 0,
        "Requires root privileges to validate runner chown/setuid isolation.",
    )
    def test_executes_under_restricted_identity_and_transfers_artifacts(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ai-ch-sandbox-test-") as tmp:
            # The runner child drops privileges, so its ancestor directory
            # must be traversable just like /work in the deployed container.
            os.chmod(tmp, 0o711)
            root = Path(tmp) / "work"
            root.mkdir()
            projects = root / "projects"
            projects.mkdir()

            with (
                patch.object(server, "WORK", str(root)),
                patch.object(server, "PROJECTS", str(projects)),
            ):
                result = server.execute(
                    "print('sandbox-ok')\n"
                    "from pathlib import Path\n"
                    "Path('artifact.txt').write_text('artifact-data', encoding='utf-8')",
                    timeout=5,
                )

            self.assertTrue(result["ok"], result.get("stderr"))
            self.assertIn("sandbox-ok", result["stdout"])
            self.assertEqual(len(result["files"]), 1)
            artifact = result["files"][0]
            self.assertEqual(artifact["name"], "artifact.txt")
            self.assertEqual(
                base64.b64decode(artifact["content_base64"], validate=True),
                b"artifact-data",
            )
            self.assertNotIn("content_base64", result["stdout"])

    def test_runner_rejects_unauthenticated_requests_when_key_is_required(self) -> None:
        handler = object.__new__(server.Handler)
        handler.headers = {}
        with patch.object(
            server.os,
            "environ",
            {"SANDBOX_API_KEY": "test-secret", "SANDBOX_REQUIRE_AUTH": "1"},
        ):
            self.assertEqual(server.os.environ["SANDBOX_API_KEY"], "test-secret")
            self.assertFalse(handler._authorized())
            handler.headers["Authorization"] = "Bearer test-secret"
            self.assertTrue(handler._authorized())
            handler.headers["Authorization"] = "Bearer wrong"
            self.assertFalse(handler._authorized())


if __name__ == "__main__":
    unittest.main()
