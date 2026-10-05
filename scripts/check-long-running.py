#!/usr/bin/env python3
"""Exercise detached jobs through the public collector CLI using temporary fixtures."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parent.parent
ACTIVE = {"preparing", "running"}
QUIET_SECONDS = max(6, float(os.environ.get("TEST_PROGRESS_QUIET_SECONDS", "6")))


class LongRunningTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-progress-long-")
        self.app = Path(self.temporary.name)
        self.owner = "long-running-check-" + uuid.uuid4().hex
        self.node = shutil.which("node")
        self.job = None
        self.state_directory = None

    def collect(self, action, ok=True):
        argv = [self.node, str(ROOT / "runner/cli.mjs"), action,
                "--cwd", str(self.app), "--owner", self.owner, "--module", "backend"]
        reply = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        data = json.loads(reply.stdout)
        self.assertEqual(data["ok"], ok, data)
        self.assertIn("backend", data["jobs"], data)
        self.job = data["jobs"]["backend"]
        if self.job:
            self.state_directory = Path(self.job["logPath"]).parent
        return self.job

    def start(self, body):
        fixture = self.app / "suite.mjs"
        fixture.write_text(
            "import fs from 'fs';\n"
            "const event = (n, final = false) => console.log('@@TEST_PROGRESS@@' + JSON.stringify({"
            "scope:'long-test', total:2, resolved:n, passed:n, failed:0, skipped:0, "
            "totalStable:true, final}));\n" + body, encoding="utf-8")
        config = self.app / ".claude"
        config.mkdir()
        (config / "test-progress.json").write_text(json.dumps({"schemaVersion": 2, "modules": {"backend": {
            "command": [self.node, str(fixture)], "cwd": ".", "adapter": "events"
        }}}), encoding="utf-8")
        return self.collect("start")

    def until(self, predicate, timeout=12):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.collect("status")
            if predicate(job):
                return job
            time.sleep(0.15)
        self.fail("Collector condition timed out: " + repr(self.job))

    def tearDown(self):
        try:
            if self.job and (self.job["status"] in ACTIVE or self.job.get("recoveryRequired")):
                self.collect("cancel")
                self.until(lambda job: job["status"] not in ACTIVE and not job.get("recoveryRequired"))
        finally:
            if self.state_directory and self.job and self.job["status"] not in ACTIVE and not self.job.get("recoveryRequired"):
                expected = hashlib.sha256((str(self.app.resolve()) + "\0" + self.owner).encode()).hexdigest()
                self.assertEqual(self.state_directory.name, expected)
                self.assertFalse((self.state_directory / "backend.lock").exists())
                shutil.rmtree(str(self.state_directory))
            self.temporary.cleanup()

    def test_quiet_job_survives_clients_and_persists_activity(self):
        # Every query is a fresh process. No status client remains alive to keep the suite running.
        self.start("event(1);\nconst timer = setInterval(() => {\n"
                   " if (fs.existsSync('release')) { clearInterval(timer); event(2, true); }\n"
                   "}, 50);\n")
        first = self.until(lambda job: job["resolved"] == 1)
        self.assertTrue(first.get("heartbeatAt"), "A quiet job needs a persisted worker heartbeat")
        self.assertTrue(first["lastOutputAt"])
        self.assertTrue(first["lastProgressAt"])
        # Leave the worker entirely alone for longer than a Mod's 5-second query timeout.
        time.sleep(QUIET_SECONDS)
        active = self.collect("status")
        self.assertEqual(active["status"], "running")
        self.assertEqual(active["runId"], first["runId"])
        self.assertEqual(active["resolved"], 1)
        self.assertGreater(active["heartbeatAt"], first["heartbeatAt"])
        self.assertEqual(active["lastOutputAt"], first["lastOutputAt"])
        self.assertEqual(active["lastProgressAt"], first["lastProgressAt"])
        self.assertGreaterEqual(active["elapsedMs"], 6000)
        self.assertLess(active["heartbeatAgeMs"], 5500)
        (self.app / "release").touch()
        final = self.until(lambda job: job["status"] not in ACTIVE)
        self.assertEqual((final["status"], final["resolved"], final["exitCode"]), ("completed", 2, 0))
        time.sleep(0.2)
        self.assertEqual(self.collect("status")["elapsedMs"], final["elapsedMs"])

    def test_silent_job_has_no_fabricated_results_and_can_cancel(self):
        self.start("setInterval(() => {}, 1000);\n")
        initial = self.until(lambda job: job["status"] == "running")
        active = self.until(lambda job: job.get("heartbeatAt", "") > initial["heartbeatAt"])
        self.assertEqual(active["resolved"], 0)
        self.assertIsNone(active["total"])
        self.assertIsNone(active["lastOutputAt"])
        self.assertIsNone(active["lastProgressAt"])
        self.collect("cancel")
        final = self.until(lambda job: job["status"] not in ACTIVE)
        self.assertEqual(final["status"], "cancelled")
        self.assertEqual(final["resolved"], 0)

    def test_log_rotation_retains_counts_and_distinguishes_output(self):
        self.start("event(1);\nsetTimeout(() => {\n"
                   " process.stdout.write('ordinary log line\\n'.repeat(100000));\n"
                   "}, 300);\nconst timer = setInterval(() => {\n"
                   " if (fs.existsSync('release')) { clearInterval(timer); event(2, true); }\n"
                   "}, 50);\n")
        first = self.until(lambda job: job["resolved"] == 1)
        active = self.until(lambda job: job["lastOutputAt"] > job["lastProgressAt"])
        self.assertEqual(active["lastProgressAt"], first["lastProgressAt"])
        self.assertEqual(active["resolved"], 1)
        self.assertLessEqual(Path(active["logPath"]).stat().st_size, 1024 * 1024)
        self.assertNotIn("@@TEST_PROGRESS@@", Path(active["logPath"]).read_text())
        (self.app / "release").touch()
        final = self.until(lambda job: job["status"] not in ACTIVE)
        self.assertEqual((final["status"], final["resolved"]), ("completed", 2))

    @unittest.skipUnless(os.name == "posix" and Path("/proc").is_dir(), "Linux process identity required")
    def test_lost_worker_supervisor_cleans_tree_and_retains_partial_results(self):
        self.start("event(1);\nsetInterval(() => {}, 1000);\n")
        initial = self.until(lambda job: job["resolved"] == 1)
        # This PID belongs to the fixture just started by this test, never to a discovered user job.
        os.kill(initial["workerPid"], signal.SIGKILL)
        final = self.until(lambda job: job["status"] not in ACTIVE and not job.get("recoveryRequired"))
        self.assertEqual(final["status"], "cancelled")
        self.assertTrue(final["infrastructureFailure"])
        self.assertEqual(final["resolved"], 1)
        self.assertIsNone(final["exitCode"])
        self.assertEqual(final["heartbeatAt"], initial["heartbeatAt"])
        self.assertFalse((self.state_directory / "backend.lock").exists())

    @unittest.skipUnless(os.name == "posix" and Path("/proc").is_dir(), "Linux process identity required")
    def test_lost_supervisor_and_worker_blocks_duplicate_until_safe_recovery(self):
        self.start("event(1);\nsetInterval(() => {}, 1000);\n")
        initial = self.until(lambda job: job["resolved"] == 1)
        claim = json.loads((self.state_directory / "backend.lock" / "claim.json").read_text())
        self.assertEqual(claim["runId"], initial["runId"])
        self.assertEqual(claim["workerIdentity"]["pid"], initial["workerPid"])
        # Both identities come from this isolated run's authenticated claim.
        os.kill(claim["coordinatorIdentity"]["pid"], signal.SIGKILL)
        os.kill(initial["workerPid"], signal.SIGKILL)
        orphan = self.until(lambda job: job.get("recoveryRequired") is True)
        self.assertEqual(orphan["status"], "error")
        self.assertEqual(orphan["phase"], "orphaned-command")
        self.assertEqual(orphan["resolved"], 1)
        self.assertIsNone(orphan["exitCode"])
        self.assertEqual(orphan["heartbeatAt"], initial["heartbeatAt"])
        self.collect("start", ok=False)
        self.assertEqual(self.job["runId"], initial["runId"])
        self.collect("cancel")
        final = self.until(lambda job: not job.get("recoveryRequired"))
        self.assertEqual(final["status"], "cancelled")


if __name__ == "__main__":
    unittest.main(verbosity=2)
