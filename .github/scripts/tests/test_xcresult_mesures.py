"""Tests for docs/qualite/ci-02/mesures/xcresult_mesures.py, the evidence tool of #67.

Run from the repository root: python3 -m unittest discover -v -s .github/scripts/tests
"""
import importlib.util
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[3] / "docs/qualite/ci-02/mesures/xcresult_mesures.py"

LOG = """00:00:10.0 Beginning test session
00:00:12.0 iPhone has testmanagerd socket
00:00:15.0 Installing app at path /x
00:00:20.0 Installed app at path /x
00:00:21.0 Launching app with identifier com.example
00:00:23.0 Launched app with identifier com.example
00:00:30.0 Test process runnable PID 1
00:00:31.0 AegisMobile[1:2] Running tests with active configuration
"""


def make_bundle(folder, name="standalone.xcresult", log=LOG):
    root = Path(folder) / name
    (root / "Data").mkdir(parents=True)
    (root / "Info.plist").write_text("<plist/>\n", encoding="utf-8")
    (root / "Data" / "data.0~log").write_text(log, encoding="utf-8")
    db = sqlite3.connect(root / "database.sqlite3")
    db.executescript("""
        create table Actions(started real, finished real);
        create table Testables(name text);
        create table TestableRuns(testable_fk integer);
        create table TestSuiteRuns(testableRun_fk integer);
        create table TestSuites(name text);
        create table TestCases(name text, testSuite_fk integer);
        create table TestCaseRuns(testCase_fk integer, testSuiteRun_fk integer, duration real, result text);
        create table Activities(title text, startTime real, finishTime real, parent_fk integer, testCaseRun_fk integer);
        insert into Actions values (0, 100);
        insert into Testables values ('AegisMobileTests'), ('AegisMobileUITests');
        insert into TestableRuns values (1), (2);
        insert into TestSuiteRuns values (1), (2);
        insert into TestSuites values ('ModelTests'), ('CatalogUITests');
        insert into TestCases values ('testModel()', 1), ('testCatalogue()', 2);
        insert into TestCaseRuns values (1, 1, 4, 'Success'), (2, 2, 50, 'Success');
        insert into Activities values
          ('Launch com.example.app', 40, 45, null, 2),
          ('Checking existence of `NavigationBar (First Match)`', 50, 51, null, 2),
          ('Added attachment named ''catalogue audit''', 60, 60, null, 2),
          ('Tear Down', 88, 90, null, 2);
    """)
    db.commit()
    db.close()
    return root


def snapshot(root):
    return {str(path.relative_to(root)): path.read_bytes() if path.is_file() else None
            for path in sorted(root.rglob("*"))}


class XcresultMeasureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def measure(self, command, bundle):
        return subprocess.run([sys.executable, "-I", str(TOOL), command, str(bundle)],
                              capture_output=True, text=True, cwd=self.folder)

    def test_complete_profile_is_measured(self):
        result = self.measure("phases", make_bundle(self.folder))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"install\s+5\.0")
        self.assertRegex(result.stdout, r"ui_launches\s+1\n")
        for command in ("audits", "ui-tests"):
            with self.subTest(command=command):
                result = self.measure(command, make_bundle(self.folder, f"{command}.xcresult"))
                self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("audits 1 total s 9.0", self.measure("audits", self.folder / "audits.xcresult").stdout)

    def test_missing_bundle_or_database_is_refused_without_creating_one(self):
        result = self.measure("phases", self.folder / "absent.xcresult")
        self.assertEqual(result.returncode, 2)
        self.assertIn("bundle introuvable", result.stderr)
        root = make_bundle(self.folder)
        (root / "database.sqlite3").unlink()
        for command in ("phases", "audits", "ui-tests"):
            with self.subTest(command=command):
                result = self.measure(command, root)
                self.assertEqual(result.returncode, 2)
                self.assertIn("absent du bundle : database.sqlite3", result.stderr)
                self.assertFalse((root / "database.sqlite3").exists())

    def test_path_with_spaces_and_uri_characters_is_read(self):
        root = make_bundle(self.folder, "run 1 #?%&mode=rwc.xcresult")
        for command in ("phases", "audits", "ui-tests"):
            with self.subTest(command=command):
                result = self.measure(command, root)
                self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), [root.name])

    def test_link_leaving_the_bundle_is_refused(self):
        outside = make_bundle(self.folder, "elsewhere.xcresult")
        for relative in ("database.sqlite3", "Data/data.0~log", "Data"):
            with self.subTest(relative=relative):
                root = make_bundle(self.folder / relative.replace("/", "-"))
                target = root / relative
                if target.is_dir():
                    for child in target.iterdir():
                        child.unlink()
                    target.rmdir()
                else:
                    target.unlink()
                target.symlink_to(outside / relative)
                result = self.measure("phases", root)
                self.assertEqual(result.returncode, 2)
                self.assertIn(f"sort du bundle par un lien : {relative}", result.stderr)

    def test_bundle_is_left_unchanged(self):
        root = make_bundle(self.folder)
        before = snapshot(root)
        for command in ("phases", "audits", "ui-tests"):
            self.assertEqual(self.measure(command, root).returncode, 0)
        self.assertEqual(snapshot(root), before)

    def test_unreadable_content_is_an_error_not_a_partial_profile(self):
        root = make_bundle(self.folder, "corrupt.xcresult")
        (root / "Data" / "data.1~zstd").write_bytes(b"\x28\xb5\x2f\xfd" + b"not a frame")
        result = self.measure("phases", root)
        self.assertEqual(result.returncode, 2)
        expected = "décompression impossible : Data/data.1~zstd"
        if importlib.util.find_spec("zstandard") is None:
            expected = "module zstandard absent"
        self.assertIn(expected, result.stderr)
        self.assertNotIn("action_total", result.stdout)

        garbage = make_bundle(self.folder, "garbage.xcresult")
        (garbage / "database.sqlite3").write_bytes(b"not a database" * 100)
        result = self.measure("audits", garbage)
        self.assertEqual(result.returncode, 2)
        self.assertIn("base illisible", result.stderr)

    def test_missing_session_markers_report_an_incomplete_profile(self):
        root = make_bundle(self.folder, log="00:00:10.0 Beginning test session\n")
        result = self.measure("phases", root)
        self.assertEqual(result.returncode, 3)
        self.assertIn("profil incomplet", result.stderr)
        self.assertRegex(result.stdout, r"install\s+absent")

    def test_usage_errors(self):
        result = self.measure("everything", make_bundle(self.folder))
        self.assertEqual(result.returncode, 2)
        self.assertIn("usage", result.stderr)
        plain = self.folder / "plain"
        plain.mkdir()
        result = self.measure("phases", plain)
        self.assertEqual(result.returncode, 2)
        self.assertIn("pas un bundle .xcresult", result.stderr)

    def test_no_path_from_the_command_line_reaches_sys_path(self):
        text = TOOL.read_text(encoding="utf-8")
        self.assertNotIn("sys.path", text)
        self.assertIn("mode=ro&immutable=1", text)


if __name__ == "__main__":
    unittest.main()
