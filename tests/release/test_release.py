"""Release metadata, provenance and fail-closed CI regression tests (stdlib only)."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("release_check", ROOT / "scripts/check-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
# The shipped manifest moves with each release; these checks follow it.
CURRENT = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())["version"]


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="release-metadata-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / ".claude-plugin").mkdir()
        for file in ("package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "CHANGELOG.md"):
            (self.root / file).write_bytes((ROOT / file).read_bytes())

    def mutate(self, file, callback):
        path = self.root / file
        data = json.loads(path.read_text())
        callback(data)
        path.write_text(json.dumps(data))

    def test_manifest_is_version_source(self):
        version, notes = release.check_metadata(self.root, CURRENT)
        self.assertEqual(version, CURRENT)
        self.assertTrue(notes)
        with self.assertRaisesRegex(ValueError, "Unexpected manifest"):
            release.check_metadata(self.root, "0.0.1")

    def test_reject_package_drift(self):
        self.mutate("package.json", lambda data: data.update(version="0.0.1"))
        with self.assertRaisesRegex(ValueError, "Package version"):
            release.check_metadata(self.root)

    def test_reject_catalog_version_even_when_matching(self):
        self.mutate(".claude-plugin/marketplace.json", lambda data: data["plugins"][0].update(version="0.3.0"))
        with self.assertRaisesRegex(ValueError, "not the catalog"):
            release.check_metadata(self.root)

    def test_reject_source_change(self):
        self.mutate(".claude-plugin/marketplace.json", lambda data: data["plugins"][0].update(source="https://example.invalid/archive.zip"))
        with self.assertRaisesRegex(ValueError, "relative source"):
            release.check_metadata(self.root)

    def test_reject_node_minimum_change(self):
        self.mutate("package.json", lambda data: data["engines"].update(node=">=24"))
        with self.assertRaisesRegex(ValueError, "Node minimum"):
            release.check_metadata(self.root)

    def test_reject_nonstable_or_malformed_versions(self):
        for version in ("v0.3.0", "00.3.0", "0.3", "0.3.0-rc.1", "0.3.0+build", "0.3.0\n", None):
            with self.subTest(version=version):
                self.mutate(".claude-plugin/plugin.json", lambda data: data.update(version=version))
                with self.assertRaisesRegex(ValueError, "stable SemVer"):
                    release.check_metadata(self.root)

    def test_notes_only_include_selected_version(self):
        (self.root / "CHANGELOG.md").write_text("# Changes\n\n## [0.3.0] - Pending\n\nNew behavior\n\n## [0.0.1]\n\nOld behavior\n")
        self.assertEqual(release.release_notes(self.root, "0.3.0"), "New behavior")

    def test_release_heading_requires_valid_date_when_dated(self):
        release.check_metadata(self.root, CURRENT, dated=True)
        for heading in ("## [0.3.0] - Pending", "## [0.3.0] - 2026-13-40", "## [0.3.0]", "## [0.3.0] - 2026-10-05 draft"):
            with self.subTest(heading=heading):
                (self.root / "CHANGELOG.md").write_text(heading + "\n\nNotes\n")
                with self.assertRaisesRegex(ValueError, "release date"):
                    release.release_notes(self.root, "0.3.0", dated=True)
        (self.root / "CHANGELOG.md").write_text("## [0.3.0] - Pending\n\nNotes\n")
        self.assertEqual(release.release_notes(self.root, "0.3.0"), "Notes")
        (self.root / "CHANGELOG.md").write_text("## [0.3.0] - 2026-10-05\n\nNotes\n")
        self.assertEqual(release.release_notes(self.root, "0.3.0", dated=True), "Notes")

    def test_reject_relative_links_in_notes(self):
        for link in ("docs/USAGE.md", "#instalar", "../README.md", "http://example.invalid/x"):
            with self.subTest(link=link):
                (self.root / "CHANGELOG.md").write_text("## [0.3.0]\n\nSee [guide](" + link + ").\n")
                with self.assertRaisesRegex(ValueError, "absolute https"):
                    release.release_notes(self.root, "0.3.0")
        (self.root / "CHANGELOG.md").write_text("## [0.3.0]\n\nSee [guide](https://example.invalid/x#a).\n")
        self.assertIn("https://example.invalid/x#a", release.release_notes(self.root, "0.3.0"))

    def test_reject_missing_duplicate_or_empty_notes(self):
        for text in ("# Empty", "## [0.3.0]\n", "## [0.3.0]\nFirst\n## [0.3.0]\nSecond"):
            (self.root / "CHANGELOG.md").write_text(text)
            with self.assertRaises(ValueError):
                release.release_notes(self.root, "0.3.0")


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="release-git-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-b", "main")
        self.git("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid",
                 "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "initial")
        self.sha = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return release.git(self.root, *args)

    def test_exact_clean_sha_on_main(self):
        self.assertEqual(release.check_provenance(self.root, "0.3.0", self.sha, "main", True),
                         (self.sha, "test-progress--v0.3.0"))

    def test_reject_wrong_short_and_injected_sha(self):
        for sha in ("0" * 40, self.sha[:7], "HEAD", "$(echo injected)"):
            with self.assertRaises(ValueError):
                release.check_provenance(self.root, "0.3.0", sha)

    def test_reject_dirty_tree_including_untracked(self):
        (self.root / "unreviewed.txt").write_text("not committed")
        with self.assertRaisesRegex(ValueError, "not clean"):
            release.check_provenance(self.root, "0.3.0", clean=True)

    def test_reject_commit_not_on_main(self):
        self.git("checkout", "-b", "feature")
        self.git("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid",
                 "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "feature")
        with self.assertRaises(ValueError):
            release.check_provenance(self.root, "0.3.0", main_ref="main")

    def test_reject_published_or_older_version(self):
        self.git("-c", "tag.gpgsign=false", "tag", "test-progress--v0.3.0")
        with self.assertRaisesRegex(ValueError, "already exists"):
            release.check_provenance(self.root, "0.3.0")
        with self.assertRaisesRegex(ValueError, "must exceed"):
            release.check_provenance(self.root, "0.2.9")
        release.check_provenance(self.root, "0.3.1")


class CiTests(unittest.TestCase):
    def run_record(self, **changes):
        record = dict(id=100, head_sha="a" * 40, event="push", head_branch="main",
                      path=".github/workflows/quality.yml", status="completed", conclusion="success",
                      head_repository={"full_name": "example/plugin"}, html_url="https://example.invalid/run/100")
        record.update(changes)
        return record

    def check(self, records):
        return release.check_workflow_runs({"workflow_runs": records}, "a" * 40, "quality.yml", "example/plugin")

    def test_gates_cover_every_push_workflow(self):
        pushed = {path.name for path in (ROOT / ".github/workflows").glob("*.yml")
                  if "\n  push:" in path.read_text(encoding="utf-8")}
        self.assertEqual(set(release.WORKFLOWS), pushed)

    def test_matching_success(self):
        self.assertEqual(self.check([self.run_record()]), "https://example.invalid/run/100")

    def test_missing_wrong_sha_branch_event_repository_or_workflow(self):
        for changes in ({"head_sha": "b" * 40}, {"head_branch": "feature"}, {"event": "pull_request"},
                        {"head_repository": {"full_name": "other/plugin"}}, {"path": ".github/workflows/other.yml"}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "Missing"):
                self.check([self.run_record(**changes)])
        with self.assertRaisesRegex(ValueError, "Missing"):
            self.check([])

    def test_newer_failure_or_pending_run_overrides_old_success(self):
        for changes in ({"conclusion": "failure"}, {"conclusion": "cancelled"},
                        {"conclusion": "skipped"}, {"status": "in_progress", "conclusion": None}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "not successful"):
                self.check([self.run_record(), self.run_record(id=101, **changes)])


if __name__ == "__main__":
    unittest.main()
