"""Commit parsing, version bump and changelog rendering for scripts/release.py."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("release_semver", ROOT / "scripts/release.py")
semver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(semver)


def change(subject, body=""):
    return semver.parse_commit("a" * 40, subject, body)


class ParseTests(unittest.TestCase):
    def test_gitmoji_and_plain_headers(self):
        parsed = change("✨ feat(panel): open the pane")
        self.assertEqual((parsed["type"], parsed["scope"], parsed["description"]), ("feat", "panel", "open the pane"))
        self.assertEqual(change("fix: plain header")["type"], "fix")
        self.assertIsNone(change("Validate JUnit through real runners"))

    def test_breaking_from_bang_or_note_without_trailers(self):
        self.assertEqual(change("💥 refactor!: drop v1")["breaking"], "drop v1")
        body = "Details.\n\nBREAKING CHANGE: needs Java 17\nand more.\n\nCo-Authored-By: Someone <x@y>\n"
        self.assertEqual(change("💥 build(junit)!: require Java 17", body)["breaking"], "needs Java 17 and more.")
        self.assertIsNone(change("fix: ok", "Not BREAKING CHANGE: here")["breaking"])


class BumpTests(unittest.TestCase):
    def test_rules(self):
        self.assertEqual(semver.bump((0, 6, 0), [change("fix: a"), change("feat: b")]), (0, 7, 0))
        self.assertEqual(semver.bump((0, 6, 0), [change("⚡️ perf: a")]), (0, 6, 1))
        self.assertEqual(semver.bump((0, 6, 3), [change("refactor!: a")]), (0, 7, 0))
        self.assertEqual(semver.bump((1, 2, 3), [change("refactor!: a")]), (2, 0, 0))
        self.assertIsNone(semver.bump((0, 6, 0), [change("docs: a"), change("chore: b")]))


class SectionTests(unittest.TestCase):
    def test_groups_dedupes_and_links_absolutely(self):
        text = semver.section((0, 7, 0), "2026-10-07", [change("feat(panel): a"), change("feat(panel): a"),
                                                         change("chore: hidden")])
        self.assertTrue(text.startswith("## [0.7.0] - 2026-10-07\n"))
        self.assertEqual(text.count("**panel:** a"), 1)
        self.assertNotIn("hidden", text)
        self.assertIn("(https://github.com/fabiopbarbieri/claude-test-progress/commit/" + "a" * 40 + ")", text)


if __name__ == "__main__":
    unittest.main()
