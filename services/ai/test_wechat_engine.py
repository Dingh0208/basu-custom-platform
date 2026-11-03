import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import wechat_engine as engine


class WechatEngineStartupTests(unittest.TestCase):
    def setUp(self):
        sandbox = tempfile.TemporaryDirectory(prefix="clienthub-engine-tests-")
        self.addCleanup(sandbox.cleanup)
        self.root = Path(sandbox.name)
        self.data = self.root / "data"
        self.backend = self.root / "wechat-backend.exe"
        self.backend.write_bytes(b"test fixture")
        for target, value in (
            ("_process", None), ("_log_handle", None), ("_last_start_error", ""),
            ("_retry_after", 0.0), ("_runtime_temp", None), ("_log_offset", 0),
        ):
            active = patch.object(engine, target, value)
            active.start()
            self.addCleanup(active.stop)
        for active in (
            patch.dict(os.environ, {
                "WECHAT_DATA_ANALYSIS_DATA_DIR": str(self.data),
                "WECHAT_DATA_ANALYSIS_OUTPUT_DIR": str(self.data / "output"),
                "LOCALAPPDATA": str(self.root / "local"),
            }),
            patch.object(engine, "_find_backend", return_value=self.backend),
            patch.object(engine.time, "sleep"),
        ):
            active.start()
            self.addCleanup(active.stop)

    def tearDown(self):
        if engine._log_handle is not None:
            engine._log_handle.close()

    def failed_process(self, *args, **kwargs):
        kwargs["stdout"].write("[PYI-123:ERROR] Could not create temporary directory!\n")
        return Mock(returncode=4294967295, poll=Mock(return_value=4294967295))

    def test_spawn_uses_writable_private_temp_and_resets_frozen_parent_environment(self):
        with patch.dict(os.environ, {"TEMP": "missing-parent-temp", "_PYI_APPLICATION_HOME_DIR": "old-sidecar-extraction"}), patch.object(engine.subprocess, "Popen") as popen:
            engine._spawn()
        child_env = popen.call_args.kwargs["env"]
        for name in ("TEMP", "TMP", "TMPDIR"):
            self.assertEqual(child_env[name], str(self.data / "runtime-temp"))
            self.assertTrue(Path(child_env[name]).is_dir())
        self.assertEqual(child_env["PYINSTALLER_RESET_ENVIRONMENT"], "1")
        self.assertFalse(list((self.data / "runtime-temp").glob("probe-*")))

    def test_temp_failure_is_bounded_and_polling_does_not_respawn_during_cooldown(self):
        with patch.object(engine, "_health", return_value=None), patch.object(engine.subprocess, "Popen", side_effect=self.failed_process) as popen:
            with self.assertRaisesRegex(RuntimeError, "无法创建解包临时目录"):
                engine.ensure_engine()
            self.assertEqual(popen.call_count, 2)
            self.assertNotEqual(popen.call_args_list[0].kwargs["env"]["TEMP"], popen.call_args_list[1].kwargs["env"]["TEMP"])
            status = engine.status()
            self.assertEqual(popen.call_count, 2)
            self.assertFalse(status["available"])
            self.assertGreater(status["retryAfterSeconds"], 0)
            self.assertTrue(any("覆盖安装" in step for step in status["repairSteps"]))
            self.assertEqual(status["logPath"], str(self.data / "clienthub-wechat-engine.log"))
            with self.assertRaises(RuntimeError):
                engine.ensure_engine(force_retry=True)
            self.assertEqual(popen.call_count, 4)

    def test_retry_can_recover_on_second_attempt(self):
        with patch.object(engine.subprocess, "Popen", side_effect=self.failed_process) as popen:
            with patch.object(engine, "_health", side_effect=lambda: {"status": "healthy"} if popen.call_count == 2 else None):
                result = engine.ensure_engine()
        self.assertTrue(result["available"])
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(engine._retry_after, 0)

    def test_unusable_primary_directory_uses_alternate_directory(self):
        self.data.mkdir()
        (self.data / "runtime-temp").write_bytes(b"not a directory")
        selected = engine._prepare_runtime_temp()
        self.assertEqual(selected, self.root / "local" / "ClientHub" / "wechat-runtime")

    def test_unwritable_temp_stops_before_spawning_any_executable(self):
        with patch.object(engine, "_health", return_value=None), patch.object(engine.tempfile, "TemporaryDirectory", side_effect=PermissionError("write denied")), patch.object(engine.subprocess, "Popen") as popen:
            with self.assertRaisesRegex(RuntimeError, "临时目录不可写"):
                engine.ensure_engine()
        popen.assert_not_called()

    def test_timeout_stops_owned_process_tree_before_retry(self):
        processes = [Mock(pid=123, poll=Mock(return_value=None)), Mock(pid=456, poll=Mock(return_value=None))]
        with patch.object(engine, "_health", return_value=None), patch.object(engine.subprocess, "Popen", side_effect=processes), patch.object(engine.subprocess, "run") as taskkill:
            with self.assertRaisesRegex(RuntimeError, "超时"):
                engine.ensure_engine(timeout_seconds=0)
        if os.name == "nt":
            self.assertEqual([call.args[0] for call in taskkill.call_args_list], [["taskkill", "/PID", "123", "/T", "/F"], ["taskkill", "/PID", "456", "/T", "/F"]])
        else:
            for process in processes:
                process.terminate.assert_called_once()
        self.assertIsNone(engine._process)

    def test_diagnostic_does_not_reuse_old_temp_failure(self):
        self.data.mkdir()
        log = self.data / "clienthub-wechat-engine.log"
        log.write_bytes(b"Could not create temporary directory!\n")
        engine._log_offset = log.stat().st_size
        with log.open("a") as handle:
            handle.write("native broker did not become ready in time\n")
        message = engine._start_failure("退出码 1")
        self.assertIn("本地数据库组件未就绪", message)
        self.assertNotIn("解包临时目录", message)


if __name__ == "__main__":
    unittest.main()
