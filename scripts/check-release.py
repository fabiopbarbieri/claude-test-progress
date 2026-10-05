#!/usr/bin/env python3
"""Validate release metadata/provenance without changing files, refs or releases."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
WORKFLOWS = ("quality.yml", "ruby.yml", "rails.yml", "adapters.yml")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(root, *args):
    result = subprocess.run(["git", *args], cwd=str(root), capture_output=True,
                            text=True, timeout=30)
    require(result.returncode == 0, "Git check failed: " + args[0])
    return result.stdout.strip()


def release_notes(root, version):
    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
    headings = list(re.finditer(r"^## \[([^\]]+)\][^\n]*$", changelog, re.M))
    matches = [i for i, heading in enumerate(headings) if heading.group(1) == version]
    require(len(matches) == 1, "Changelog must contain exactly one heading for " + version)
    index = matches[0]
    end = headings[index + 1].start() if index + 1 < len(headings) else len(changelog)
    notes = changelog[headings[index].end():end].strip()
    require(bool(notes), "Release notes are empty")
    return notes


def check_metadata(root, expected_version=None):
    plugin = json.loads((root / ".claude-plugin/plugin.json").read_text())
    package = json.loads((root / "package.json").read_text())
    catalog = json.loads((root / ".claude-plugin/marketplace.json").read_text())
    version = plugin.get("version", "")
    require(isinstance(version, str) and bool(VERSION.fullmatch(version)),
            "Manifest version must be stable SemVer X.Y.Z (no leading zeroes)")
    require(expected_version is None or expected_version == version, "Unexpected manifest version")
    require(plugin.get("name") == "test-progress", "Plugin identity changed")
    require(package.get("name") == "claude-test-progress", "Package identity changed")
    require(package.get("version") == version, "Package version differs from manifest")
    require(plugin.get("license") == package.get("license") == "MIT", "License changed")
    require(package.get("engines", {}).get("node") == ">=14.0.0", "Collector Node minimum changed")
    require(catalog.get("name") == "test-progress-marketplace", "Marketplace identity changed")
    entries = catalog.get("plugins", [])
    require(len(entries) == 1 and entries[0].get("name") == plugin["name"], "Unexpected catalog entries")
    require(entries[0].get("source") == "./", "Keep the Git marketplace relative source ./")
    require("version" not in entries[0], "Version belongs only in plugin.json, not the catalog")
    return version, release_notes(root, version)


def check_provenance(root, version, expected_sha=None, main_ref=None, clean=False):
    if expected_sha is not None:
        require(bool(SHA.fullmatch(expected_sha)), "Expected a full lowercase 40-character commit SHA")
    head = git(root, "rev-parse", "HEAD")
    require(expected_sha is None or head == expected_sha, "HEAD differs from chosen SHA")
    if clean:
        require(not git(root, "status", "--porcelain", "--untracked-files=all"), "Working tree is not clean")
    if main_ref:
        git(root, "merge-base", "--is-ancestor", head, main_ref)
    tag = "test-progress--v" + version
    tags = git(root, "tag", "--list", "test-progress--v*").splitlines()
    require(tag not in tags, "Release tag already exists; never move or reuse it")
    current = tuple(map(int, version.split(".")))
    for existing in tags:
        suffix = existing[len("test-progress--v"):]
        if VERSION.fullmatch(suffix):
            require(current > tuple(map(int, suffix.split("."))), "Version must exceed existing stable release tags")
    return head, tag


def check_workflow_runs(payload, sha, workflow, repository):
    # Select the latest run, including a pending/failed rerun; an older success is insufficient.
    runs = [run for run in payload.get("workflow_runs", [])
            if run.get("head_sha") == sha and run.get("event") == "push"
            and run.get("head_branch") == "main"
            and run.get("path") == ".github/workflows/" + workflow
            and run.get("head_repository", {}).get("full_name") == repository]
    require(bool(runs), "Missing main/push CI on chosen SHA: " + workflow)
    latest = max(runs, key=lambda run: run["id"])
    require(latest.get("status") == "completed" and latest.get("conclusion") == "success",
            "Latest CI is not successful on chosen SHA: " + workflow)
    return latest["html_url"]


def check_github_ci(sha, repository):
    require(bool(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)), "Invalid repository")
    urls = []
    for workflow in WORKFLOWS:
        endpoint = ("repos/{}/actions/workflows/{}/runs?head_sha={}&event=push&branch=main&per_page=100"
                    .format(repository, workflow, sha))
        result = subprocess.run(["gh", "api", endpoint], capture_output=True, text=True, timeout=30)
        require(result.returncode == 0, "Cannot read CI for " + workflow)
        urls.append(check_workflow_runs(json.loads(result.stdout), sha, workflow, repository))
    return urls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-sha")
    parser.add_argument("--main-ref", help="Require HEAD to be reachable from this already-fetched ref")
    parser.add_argument("--require-clean", action="store_true")
    parser.add_argument("--github-ci", metavar="OWNER/REPO", help="Require successful main/push CI at HEAD (gh CLI)")
    parser.add_argument("--notes", action="store_true", help="Print this version's notes after validation")
    args = parser.parse_args()
    try:
        version, notes = check_metadata(ROOT, args.expected_version)
        sha, tag = check_provenance(ROOT, version, args.expected_sha, args.main_ref, args.require_clean)
        urls = check_github_ci(sha, args.github_ci) if args.github_ci else []
        if args.notes:
            print(notes)
        else:
            print(json.dumps({"version": version, "tag": tag, "sha": sha, "ci": urls,
                              "publication": "not performed"}, indent=2))
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print("Release check failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
