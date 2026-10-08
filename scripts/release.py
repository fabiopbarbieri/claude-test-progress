#!/usr/bin/env python3
"""Semantic versioning and changelog from gitmoji + Conventional Commits.

`next` prints the version the unreleased commits call for (empty when none).
`prepare` bumps the manifests and prepends that version's changelog section.
`changelog` rebuilds CHANGELOG.md from every release bump in history.
Nothing here creates tags or releases; publication stays a human step.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ".claude-plugin/plugin.json"
REPOSITORY = "https://github.com/fabiopbarbieri/claude-test-progress"
# 0.1.0 and 0.2.0 were never published; their history belongs to 0.3.0.
FIRST_RELEASE = (0, 3, 0)
# Optional leading gitmoji, then `type(scope)!: description`.
HEADER = re.compile(r"^(?:\S+\s+)?([a-z]+)(?:\(([^)]*)\))?(!)?: (.+)$")
# The note ends at the first blank line, before trailers such as Co-Authored-By.
BREAKING = re.compile(r"^BREAKING[ -]CHANGE: *(.+?)(?:\n\s*\n|\Z)", re.M | re.S)
SECTIONS = (("breaking", "⚠ Mudanças incompatíveis"), ("feat", "Funcionalidades"),
            ("fix", "Correções"), ("perf", "Desempenho"), ("docs", "Documentação"))
VERSION_MENTIONS = (("README.md", r"(Versão \*\*)([0-9.]+)(\*\*)"),
                    ("docs/COMPATIBILITY.md", r"(Matriz da versão \*\*)([0-9.]+)(\*\*)"))
INTRO = """# Changelog

Gerado por `scripts/release.py` a partir dos commits (gitmoji + Conventional
Commits). A versão em `.claude-plugin/plugin.json` identifica o plugin
distribuído; `package.json` acompanha esse valor.
"""


def git(*args):
    result = subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError("git {} failed: {}".format(args[0], result.stderr.strip()))
    return result.stdout


def parse_version(text):
    return tuple(int(part) for part in text.split("."))


def show_version(version):
    return ".".join(str(part) for part in version)


def parse_commit(sha, subject, body):
    match = HEADER.match(subject.strip())
    if not match:
        return None
    kind, scope, bang, description = match.groups()
    note = BREAKING.search(body)
    breaking = note.group(1).strip().replace("\n", " ") if note else (description if bang else None)
    return {"sha": sha, "type": kind, "scope": scope, "description": description, "breaking": breaking}


def commits(revisions):
    log = git("log", "--no-merges", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", *revisions)
    parsed = []
    for record in log.split("\x1e"):
        if record.strip():
            sha, subject, body = record.strip("\n").split("\x1f")
            commit = parse_commit(sha, subject, body)
            if commit:
                parsed.append(commit)
    return parsed


def bump(version, changes):
    if any(change["breaking"] for change in changes):
        # While 0.x, breaking changes take a new minor (docs/RELEASING.md).
        return (version[0] + 1, 0, 0) if version[0] else (0, version[1] + 1, 0)
    if any(change["type"] == "feat" for change in changes):
        return (version[0], version[1] + 1, 0)
    if any(change["type"] in ("fix", "perf") for change in changes):
        return (version[0], version[1], version[2] + 1)
    return None


def entry(change, text):
    scope = "**{}:** ".format(change["scope"]) if change["scope"] else ""
    link = "[{}]({}/commit/{})".format(change["sha"][:7], REPOSITORY, change["sha"])
    return "- {}{} ({})".format(scope, text, link)


def section(version, date, changes):
    # Rebased or cherry-picked commits repeat a subject; list it once.
    unique = {}
    for change in changes:
        unique.setdefault((change["type"], change["scope"], change["description"]), change)
    changes = list(unique.values())
    lines = ["## [{}] - {}".format(show_version(version), date)]
    for key, title in SECTIONS:
        if key == "breaking":
            items = [entry(change, change["breaking"]) for change in changes if change["breaking"]]
        else:
            items = [entry(change, change["description"]) for change in changes if change["type"] == key]
        if items:
            lines += ["", "### " + title, ""] + items
    if len(lines) == 1:
        lines += ["", "Sem mudanças visíveis para usuários."]
    return "\n".join(lines) + "\n"


def releases():
    """(version, bump commit) for each manifest version change, oldest first."""
    found, seen = [], set()
    for sha in git("log", "--reverse", "--format=%H", "--", MANIFEST).split():
        try:
            version = parse_version(json.loads(git("show", sha + ":" + MANIFEST))["version"])
        except (RuntimeError, KeyError, ValueError):
            continue
        if version not in seen:
            seen.add(version)
            found.append((version, sha))
    return found


def commit_date(sha):
    return git("log", "-1", "--format=%cd", "--date=short", sha).strip()


def rebuild():
    sections, previous = [], None
    for version, sha in releases():
        if version < FIRST_RELEASE:
            continue
        revisions = [sha] if previous is None else [previous + ".." + sha]
        sections.append(section(version, commit_date(sha), commits(revisions)))
        previous = sha
    return INTRO + "".join("\n" + text for text in reversed(sections))


def pending():
    version, sha = releases()[-1]
    changes = commits([sha + "..HEAD"])
    return version, bump(version, changes), changes


def write_json_version(path, version):
    file = ROOT / path
    text = file.read_text(encoding="utf-8")
    updated, count = re.subn(r'("version":\s*")[0-9.]+(")', r"\g<1>{}\g<2>".format(version), text, count=1)
    if count != 1:
        raise RuntimeError("No version field in " + path)
    file.write_text(updated, encoding="utf-8")


def prepare(date):
    current, version, changes = pending()
    if version is None:
        return None
    text = show_version(version)
    for path in (MANIFEST, "package.json"):
        write_json_version(path, text)
    for path, pattern in VERSION_MENTIONS:
        file = ROOT / path
        updated, count = re.subn(pattern, r"\g<1>{}\g<3>".format(text), file.read_text(encoding="utf-8"), count=1)
        if count != 1:
            raise RuntimeError("No version mention in " + path)
        file.write_text(updated, encoding="utf-8")
    changelog = ROOT / "CHANGELOG.md"
    old = changelog.read_text(encoding="utf-8")
    first = re.search(r"^## \[", old, re.M)
    head, rest = (old[:first.start()], old[first.start():]) if first else (old.rstrip() + "\n\n", "")
    changelog.write_text(head + section(version, date, changes) + "\n" + rest, encoding="utf-8")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("next", "prepare", "changelog"))
    parser.add_argument("--date", default=datetime.date.today().isoformat(), help="Release date (YYYY-MM-DD)")
    args = parser.parse_args()
    try:
        if args.command == "next":
            version = pending()[1]
            print(show_version(version) if version else "")
        elif args.command == "prepare":
            print(prepare(args.date) or "")
        else:
            (ROOT / "CHANGELOG.md").write_text(rebuild(), encoding="utf-8")
    except (RuntimeError, OSError, ValueError) as error:
        print("Release failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
