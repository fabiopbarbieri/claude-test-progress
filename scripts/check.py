#!/usr/bin/env python3
"""Portable release checks; all smoke fixtures and runtime state stay temporary."""
import argparse
import ast
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent


def command(argv, cwd=ROOT, timeout=30, env=None):
    result = subprocess.run([str(arg) for arg in argv], cwd=str(cwd), env=env,
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("{} failed:\n{}{}".format(argv[0], result.stdout, result.stderr))
    return result.stdout


def source_files():
    names = command(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    deleted = set(command(["git", "ls-files", "--deleted", "-z"]).split("\0"))
    return [ROOT / name for name in sorted(set(names.split("\0"))) if name and name not in deleted]


def static_checks():
    for file in source_files():
        relative = file.relative_to(ROOT)
        if file.is_symlink():
            raise RuntimeError("Symlink is not allowed in the release: " + str(relative))
        if not file.is_file():
            raise RuntimeError("Missing release file: " + str(relative))
        if any(part in {".claude", "__pycache__", ".venv", "node_modules", "build", "target"}
               for part in relative.parts) or relative.parts[:2] == (".claude-plugin", "types"):
            raise RuntimeError("Local/generated file in release: " + str(relative))
        if file.suffix.lower() in {".key", ".pem", ".p12", ".pfx", ".log", ".pyc", ".jar", ".class"} or file.name.startswith(".env"):
            raise RuntimeError("Private/generated file in release: " + str(relative))
        if file.suffix == ".png":
            if not file.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("Invalid PNG: " + str(relative))
            continue
        text = file.read_text(encoding="utf-8-sig")
        if any(line.rstrip() != line for line in text.splitlines()):
            raise RuntimeError("Trailing whitespace: " + str(relative))
        if re.search(r"/(?:home|Users)/[^\s/]+/|/mnt/(?:nvme|new-sabrent)", text):
            raise RuntimeError("Personal machine path: " + str(relative))
        if file.suffix in {".mjs", ".cjs", ".js"}:
            command(["node", "--check", file])
        elif file.suffix == ".py":
            ast.parse(text, filename=str(relative), feature_version=(3, 8))
        elif file.suffix == ".sh":
            command(["bash", "-n", file])
        elif file.suffix == ".json":
            json.loads(text)
        elif file.suffix == ".xml":
            ET.fromstring(text)
        elif file.suffix == ".md":
            for target in re.findall(r"\]\(([^)\s]+)\)", text):
                if re.match(r"[a-z]+:", target) or target.startswith("#"):
                    continue
                if not (file.parent / target.split("#")[0]).exists():
                    raise RuntimeError("Broken local link in {}: {}".format(relative, target))
    plugin = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())
    marketplace = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    package = json.loads((ROOT / "package.json").read_text())
    assert marketplace["plugins"][0]["name"] == plugin["name"] == "test-progress"
    assert marketplace["plugins"][0]["source"] in (".", "./")
    assert plugin["version"] == package["version"]
    assert plugin["license"] == package["license"] == "MIT"
    command(["git", "diff", "--check"])
    print("Source, manifests, links and syntax: OK", flush=True)


def smoke_checks(include_pytest=False):
    node = shutil.which("node")
    with tempfile.TemporaryDirectory(prefix="test-progress-smoke-") as temporary:
        app = Path(temporary) / "project with spaces"
        app.mkdir()
        (app / "test_cases.py").write_text(
            "import unittest\nimport time\n"
            "class Cases(unittest.TestCase):\n"
            " def test_pass(self): self.assertTrue(True)\n"
            " def test_fail(self): self.fail('intentional verification failure')\n"
            " @unittest.skip('verification')\n"
            " def test_skip(self): pass\n"
            "class Slow(unittest.TestCase):\n"
            " def test_a_first(self): time.sleep(0.1)\n"
            " def test_b_second(self): time.sleep(60)\n", encoding="utf-8")

        def run_case(name, runner_args, expected, cancel=False):
            owner = "release-check-" + uuid.uuid4().hex
            config = app / (name + ".json")
            config.write_text(json.dumps({"schemaVersion": 1, "modules": {"backend": {
                "command": [sys.executable, str(ROOT / "adapters/python/run.py")] + runner_args,
                "cwd": ".", "adapter": "events", "env": {}}}}), encoding="utf-8")

            def collect(action):
                argv = [node, ROOT / "runner/cli.mjs", action, "--cwd", app,
                        "--owner", owner, "--module", "backend"]
                if action == "start":
                    argv += ["--config", config]
                reply = json.loads(command(argv, cwd=app))
                assert reply["ok"], reply
                return reply["jobs"]["backend"]

            job = collect("start")
            requested = False
            try:
                deadline = time.monotonic() + 15
                while job["status"] in ("preparing", "running") and time.monotonic() < deadline:
                    time.sleep(0.1)
                    job = collect("status")
                    if cancel and job["resolved"] >= 1 and not requested:
                        collect("cancel")
                        requested = True
                assert job["status"] not in ("preparing", "running"), "Smoke timed out"
                for key, value in expected.items():
                    assert job[key] == value, (name, key, job[key], value)
                print(name + ": OK", flush=True)
            finally:
                if job["status"] in ("preparing", "running"):
                    collect("cancel")

        run_case("unittest-outcomes", ["unittest", "-b", "test_cases.Cases"],
                 {"status": "failed", "total": 3, "resolved": 3,
                  "passed": 1, "failed": 1, "skipped": 1, "exitCode": 1})
        run_case("unittest-pass", ["unittest", "-b", "test_cases.Cases.test_pass"],
                 {"status": "completed", "total": 1, "resolved": 1, "exitCode": 0})
        run_case("cancellation", ["unittest", "test_cases.Slow"],
                 {"status": "cancelled", "total": 2, "resolved": 1, "totalStable": False}, cancel=True)
        if include_pytest:
            (app / "test_pytest.py").write_text(
                "import pytest\n"
                "@pytest.mark.parametrize('n', [1, 2])\n"
                "def test_pass(n): assert n > 0\n"
                "def test_fail(): assert False, 'intentional verification failure'\n"
                "@pytest.mark.skip(reason='verification')\n"
                "def test_skip(): pass\n", encoding="utf-8")
            run_case("pytest-outcomes", ["pytest", "-q", "test_pytest.py"],
                     {"status": "failed", "total": 4, "resolved": 4,
                      "passed": 2, "failed": 1, "skipped": 1, "exitCode": 1})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", help="Run temporary unittest/collector scenarios")
    parser.add_argument("--pytest", action="store_true", help="Also run pytest from this Python environment")
    options = parser.parse_args()
    static_checks()
    for check in sorted((ROOT / "tests/collector").glob("*.mjs")):
        print(command(["node", check], timeout=90), end="", flush=True)
    # Windows runs every worker inside its batch coordinator; exercise that path here too.
    # The fault and race checks inject process-level failures and stay process-only.
    inprocess = dict(os.environ, TEST_PROGRESS_WORKERS="inprocess")
    for name in ["exit-adapter", "log-color", "module-batch", "module-state", "module-tree", "workspace"]:
        print(command(["node", ROOT / "tests/collector" / (name + ".mjs")], timeout=90, env=inprocess), end="", flush=True)
    if options.smoke or options.pytest:
        smoke_checks(options.pytest)
