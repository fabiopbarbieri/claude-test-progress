#!/usr/bin/env python3
"""Opt-in real Claude CLI marketplace upgrade. No login, network publish or personal config.

Creates an isolated Git marketplace and preserves the temporary evidence directory.
The public SSH-shaped test URL is rewritten to a local Git transport only in child
processes. This exercises Git cache/update behavior, not GitHub/SSH authentication.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = "test-progress@test-progress-marketplace"
MARKETPLACE = "test-progress-marketplace"
SOURCE = "git@release-test.invalid:marketplace.git"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(args, cwd, env, timeout=60):
    result = subprocess.run([str(arg) for arg in args], cwd=str(cwd), env=env,
                            capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, "Command failed: " + str(args[0]) + " " + str(args[1]))
    return result.stdout.strip()


def export_commit(sha, destination, env):
    require(bool(re.fullmatch(r"[0-9a-f]{40}", sha)), "Use a full commit SHA")
    archive = subprocess.run(["git", "archive", sha], cwd=str(ROOT), env=env,
                             capture_output=True, timeout=30, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
        for member in tree.getmembers():
            name = Path(member.name)
            require(not name.is_absolute() and ".." not in name.parts, "Unsafe archive path")
            require(member.isfile() or member.isdir(), "Only regular release files are allowed")
            path = destination / name
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(tree.extractfile(member).read())
                path.chmod(member.mode & 0o777)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(cache, work, env):
    # Real stdlib unittest outcomes, not demo events. Run the installed bootstrap
    # from an unrelated directory; both plugin and project paths contain spaces.
    project = work / "project with spaces"
    project.mkdir(exist_ok=True)
    (project / "test_cases.py").write_text(
        "import unittest\n"
        "class Cases(unittest.TestCase):\n"
        " def test_pass(self): self.assertEqual(2 + 2, 4)\n"
        " def test_fail(self): self.fail('intentional fixture failure')\n"
        " @unittest.skip('fixture')\n"
        " def test_skip(self): pass\n")
    config = project / "suite.json"
    config.write_text(json.dumps({"schemaVersion": 1, "backend": {
        "cwd": ".", "adapter": "events", "env": {},
        "command": [sys.executable, str(cache / "adapters/python/run.py"), "unittest", "test_cases.Cases"]}}))
    original_config = config.read_bytes()
    owner = "release-upgrade-" + uuid.uuid4().hex

    def collect(action):
        args = ["bash", cache / "scripts/run-collector.sh", action, "--cwd", project,
                "--owner", owner, "--lane", "backend"]
        if action == "start":
            args += ["--config", config]
        response = json.loads(run(args, work, env))
        require(response.get("ok"), "Installed collector returned an error")
        return response["lanes"]["backend"]

    job = collect("start")
    try:
        deadline = time.monotonic() + 30
        while job["status"] in ("preparing", "running") and time.monotonic() < deadline:
            time.sleep(0.1)
            job = collect("status")
        expected = {"status": "failed", "total": 3, "resolved": 3, "passed": 1,
                    "failed": 1, "skipped": 1, "exitCode": 1, "totalStable": False}
        for key, value in expected.items():
            require(job.get(key) == value, "Installed suite mismatch: " + key)
        require(config.read_bytes() == original_config, "Suite config changed")
        return expected
    finally:
        if job["status"] in ("preparing", "running"):
            collect("cancel")  # Only this fixture's unique owner, never another session.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous-sha", required=True, help="Reviewed 0.1.0 commit")
    parser.add_argument("--candidate-sha", required=True, help="Committed 0.2.0 candidate")
    args = parser.parse_args()
    require(os.name == "posix", "This acceptance scenario covers Linux/Bash, not native Windows")
    claude = shutil.which("claude")
    require(claude is not None and shutil.which("node") is not None, "Claude CLI and Node are required")
    base = Path(tempfile.mkdtemp(prefix="test-progress release upgrade "))
    for name in ("home", "config", "work", "market", "previous", "candidate", "tmp"):
        (base / name).mkdir()
    # Deliberate allowlist: do not inherit tokens, auth, proxy or personal Claude/Git settings.
    env = {"PATH": os.environ["PATH"], "HOME": str(base / "home"),
           "CLAUDE_CONFIG_DIR": str(base / "config"), "TMPDIR": str(base / "tmp"),
           "XDG_CONFIG_HOME": str(base / "home" / ".config"),
           "XDG_CACHE_HOME": str(base / "home" / ".cache"),
           "XDG_DATA_HOME": str(base / "home" / ".local" / "share"),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_COUNT": "1",
           "GIT_CONFIG_KEY_0": "url." + (base / "market").as_uri() + ".insteadOf",
           "GIT_CONFIG_VALUE_0": SOURCE, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
    work = base / "work"
    print("Isolated evidence directory: " + str(base), flush=True)
    export_commit(args.previous_sha, base / "previous", env)
    export_commit(args.candidate_sha, base / "candidate", env)
    for name, version in (("previous", "0.1.0"), ("candidate", "0.2.0")):
        manifest = json.loads((base / name / ".claude-plugin/plugin.json").read_text())
        require(manifest["version"] == version, "Wrong " + name + " version")
    run(["git", "init", "-b", "main"], base / "market", env)

    def advance(snapshot):
        # Alternate exported directories through GIT_WORK_TREE; no extra git
        # worktree, source checkout mutation, remote push or user config write.
        commit_env = dict(env, GIT_WORK_TREE=str(snapshot))
        run(["git", "add", "--all"], base / "market", commit_env)
        run(["git", "-c", "user.name=Release Test", "-c", "user.email=release@example.invalid",
             "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
             "commit", "-m", "Synthetic marketplace snapshot"], base / "market", commit_env)
        return run(["git", "rev-parse", "HEAD"], base / "market", env)

    def cli(*arguments):
        return run([claude, "plugin", *arguments], work, env, timeout=180)

    def installed(version, snapshot, commit):
        entries = json.loads(cli("list", "--json"))
        require(len(entries) == 1 and entries[0]["id"] == PLUGIN, "Unexpected installed plugins")
        entry = entries[0]
        require(entry["version"] == version and entry["enabled"], "Unexpected installed version/state")
        cache = Path(entry["installPath"]).resolve()
        expected = base / "config/plugins/cache" / MARKETPLACE / "test-progress" / version
        require(cache == expected, "Plugin is not in the isolated versioned cache")
        registration = json.loads((base / "config/plugins/installed_plugins.json").read_text())
        require(registration["plugins"][PLUGIN][0]["gitCommitSha"] == commit, "Wrong cached Git commit")
        hashes = {}
        for path in snapshot.rglob("*"):
            if path.is_file():
                relative = path.relative_to(snapshot)
                require((cache / relative).is_file(), "Missing cached file: " + str(relative))
                require(digest(cache / relative) == digest(path), "Cached bytes differ: " + str(relative))
                hashes[str(relative)] = digest(path)
        hooks = json.loads((cache / "hooks/hooks.json").read_text())
        for module in hooks["modules"]:
            require((cache / "hooks" / module).is_file(), "Hook module path is broken")
        cli("validate", str(cache), "--strict")
        cli("validate", str(cache / ".claude-plugin/plugin.json"), "--strict")
        return cache, {"version": version, "cache": str(cache.relative_to(base)),
                       "syntheticMarketplaceCommit": commit, "filesVerified": len(hashes),
                       "manifestSha256": hashes[".claude-plugin/plugin.json"],
                       "suite": suite(cache, work, env)}

    old_commit = advance(base / "previous")
    cli("marketplace", "add", SOURCE, "--json")
    markets = json.loads(cli("marketplace", "list", "--json"))
    require(len(markets) == 1 and markets[0]["source"] == "git" and markets[0]["url"] == SOURCE,
            "Expected a Git marketplace, not local directory loading")
    marketplace_path = Path(markets[0]["installLocation"])
    require(marketplace_path.resolve() == base / "config/plugins/marketplaces" / MARKETPLACE,
            "Marketplace outside isolated config")
    require(run(["git", "config", "--get", "remote.origin.url"], marketplace_path, env) == SOURCE,
            "Unexpected marketplace origin")
    cli("install", PLUGIN, "--scope", "user", "--json")
    old_cache, before = installed("0.1.0", base / "previous", old_commit)
    old_manifest_hash = digest(old_cache / ".claude-plugin/plugin.json")
    settings = base / "config/settings.json"
    saved_settings = json.loads(settings.read_text())
    saved_settings["env"] = {"RELEASE_FIXTURE_SENTINEL": "preserve-user-settings"}
    settings.write_text(json.dumps(saved_settings))
    new_commit = advance(base / "candidate")
    cli("marketplace", "update", MARKETPLACE)
    cli("update", PLUGIN, "--scope", "user", "--json")
    new_cache, after = installed("0.2.0", base / "candidate", new_commit)
    require(old_cache != new_cache, "Upgrade reused the old cache directory")
    require(digest(old_cache / ".claude-plugin/plugin.json") == old_manifest_hash, "Old cache modified")
    require(json.loads(settings.read_text()) == saved_settings, "User settings changed during update")
    require(run(["git", "rev-parse", "HEAD"], marketplace_path, env) == new_commit, "Marketplace checkout is stale")
    report = {"claude": run([claude, "--version"], work, env),
              "node": run(["node", "--version"], work, env), "python": sys.version.split()[0],
              "previousSourceSha": args.previous_sha, "candidateSourceSha": args.candidate_sha,
              "marketplaceSource": {"type": "git", "url": SOURCE, "transport": "local Git rewrite"},
              "before": before, "after": after, "settingsPreserved": True,
              "limits": "No GitHub/SSH transport, remote publication, interactive Mod UI or native Windows acceptance"}
    (base / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print("Marketplace upgrade failed: " + str(error), file=sys.stderr)
        sys.exit(1)
