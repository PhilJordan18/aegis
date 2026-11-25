"""Tests of the CI scripts in .github/scripts (standard library only).

Run from the repository root: python3 -m unittest discover -v -s .github/scripts/tests

Each test builds its own throwaway Git repository or report file under a
temporary directory; nothing in the checkout is modified.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / ".github" / "scripts"
COMPONENTS = ("api", "web", "simulator", "agents", "adrs", "ios", "ios_fast", "ci")
# Every component a full run selects; the fast iOS recipe never runs on a full run.
FULL = set(COMPONENTS) - {"ios_fast"}


def run(args, cwd=None, env=None):
    full_env = {key: value for key, value in os.environ.items() if not key.startswith("GITHUB_")}
    full_env.update(env or {})
    return subprocess.run(args, cwd=cwd, env=full_env, capture_output=True, text=True)


class GitRepository:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI tests")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args):
        result = run(["git", *args], cwd=self.folder)
        if result.returncode != 0:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def commit(self, files, delete=(), message="change"):
        for path, text in files.items():
            target = self.folder / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        for path in delete:
            (self.folder / path).unlink()
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")


class ChangedComponentsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = GitRepository(self.temp.name)
        self.base = self.repo.commit({"README.txt": "base\n"})

    def tearDown(self):
        self.temp.cleanup()

    def detect(self, event="pull_request", base=None, head=None, summary=None, base_ref="dev", before=None, ref=None):
        env = {"EVENT_NAME": event, "BASE_SHA": self.base if base is None else base,
               "HEAD_SHA": head or self.repo.git("rev-parse", "HEAD"), "BASE_REF": base_ref}
        if before is not None:
            env["BEFORE_SHA"] = before
        if ref is not None:
            env["REF_NAME"] = ref
        if summary is not None:
            env["GITHUB_STEP_SUMMARY"] = str(summary)
        result = run(["sh", str(SCRIPTS / "changed-components.sh")], cwd=self.repo.folder, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        outputs = dict(line.split("=", 1) for line in result.stdout.splitlines())
        self.assertEqual(sorted(outputs), sorted(COMPONENTS), "every output must be written")
        self.assertTrue(set(outputs.values()) <= {"true", "false"}, outputs)
        return {name for name, value in outputs.items() if value == "true"}

    def test_each_component_path_selects_only_its_jobs(self):
        cases = {
            "services/api/src/Main.java": {"api"},
            "apps/admin-web/src/App.tsx": {"web"},
            "docs/design/manager-entree/tokens.css": {"web"},
            "tools/hub-simulator/src/cli.ts": {"simulator"},
            "infra/mqtt/acl": {"api", "simulator"},
            "infra/docker/compose.yaml": {"api", "simulator"},
            ".claude/agents/role.json": {"agents"},
            "docs/notes.md": {"agents"},
            "docs/adr/ADR-099-new.md": {"adrs", "agents"},
            ".githooks/check-accepted-adrs": {"adrs"},
            "apps/ios/AegisMobile/View.swift": {"ios"},
            "firmware/bench/sketch.ino": set(),
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                self.repo.commit({path: f"{path}\n"})
                self.assertEqual(self.detect(), expected)

    def test_non_visual_ios_change_into_dev_selects_the_fast_recipe(self):
        for path in ("apps/ios/AegisMobile/Networking/Client.swift",
                     "apps/ios/AegisMobileTests/ClientTests.swift", "apps/ios/README.md"):
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                self.repo.commit({path: f"{path}\n"})
                self.assertIn("ios_fast", self.detect())
                self.assertIn("ios", self.detect())

    def test_visual_or_unknown_ios_change_keeps_the_full_recipe(self):
        for path in ("apps/ios/AegisMobile/Catalog/CatalogView.swift",
                     "apps/ios/AegisMobile/Assets.xcassets/Canvas.colorset/Contents.json",
                     "apps/ios/AegisMobile/Localizable.xcstrings", "apps/ios/AegisMobileUITests/CatalogUITests.swift",
                     "apps/ios/scripts/ios-test.sh", "apps/ios/AegisMobile.xcodeproj/project.pbxproj",
                     "apps/ios/AegisMobile/Session/SessionModel.swift", "apps/ios/NewFolder/Thing.swift"):
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                self.repo.commit({path: f"{path}\n"})
                self.assertEqual({"ios"} - self.detect(), set())
                self.assertNotIn("ios_fast", self.detect())

    def test_one_visual_file_among_non_visual_ones_keeps_the_full_recipe(self):
        self.repo.commit({"apps/ios/AegisMobile/Networking/Client.swift": "a\n",
                          "apps/ios/AegisMobile/SignIn/SignInView.swift": "b\n"})
        self.assertNotIn("ios_fast", self.detect())

    def test_fast_recipe_only_for_a_pull_request_into_dev(self):
        self.repo.commit({"apps/ios/AegisMobile/Networking/Client.swift": "a\n"})
        self.assertNotIn("ios_fast", self.detect(base_ref="main"))
        self.assertNotIn("ios_fast", self.detect(base_ref=""))
        for event in ("push", "workflow_dispatch"):
            with self.subTest(event=event):
                self.assertNotIn("ios_fast", self.detect(event=event))

    def test_ios_summary_script_change_keeps_the_full_recipe(self):
        self.repo.commit({"apps/ios/AegisMobile/Networking/Client.swift": "a\n",
                          ".github/scripts/xcresult-summary.py": "b\n"})
        self.assertEqual(self.detect() & {"ios", "ios_fast"}, {"ios"})

    def test_deleted_or_renamed_file_runs_the_link_validator(self):
        self.repo.commit({"docs/diagrams/view.html": "<html/>\n", "firmware/a.ino": "a\n"})
        self.base = self.repo.git("rev-parse", "HEAD")
        self.repo.commit({}, delete=["docs/diagrams/view.html"])
        self.assertEqual(self.detect(), {"agents"})
        self.base = self.repo.git("rev-parse", "HEAD")
        self.repo.git("mv", "firmware/a.ino", "firmware/b.ino")
        self.repo.commit({})
        self.assertEqual(self.detect(), {"agents"})

    def test_untouched_components_are_skipped(self):
        self.repo.commit({"services/api/pom.xml": "<project/>\n"})
        self.assertNotIn("ios", self.detect())
        self.assertNotIn("web", self.detect())

    def test_workflow_or_unknown_ci_script_runs_every_component(self):
        for path in (".github/workflows/ci.yml", ".github/scripts/new-helper.py"):
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                self.repo.commit({path: f"{path}\n"})
                self.assertEqual(self.detect(), FULL)

    def test_known_ci_script_runs_its_tests_and_the_jobs_that_execute_it(self):
        cases = {
            ".github/scripts/tests/test_ci_scripts.py": {"ci"},
            ".github/scripts/changed-components.sh": {"ci"},
            ".github/scripts/ci-result.py": {"ci"},
            ".github/scripts/test-report.py": {"ci", "api", "web", "simulator"},
            ".github/scripts/xcresult-summary.py": {"ci", "ios"},
            ".github/scripts/simulator-load.sh": {"ci", "ios"},
            ".github/scripts/check-accepted-adrs.py": {"ci", "adrs"},
            "docs/qualite/ci-02/mesures/xcresult_mesures.py": {"ci"},
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                self.repo.commit({path: f"{path}\n"})
                self.assertEqual(self.detect(), expected)

    def test_push_runs_everything_except_the_pull_request_guard(self):
        self.repo.commit({"docs/notes.md": "x\n"})
        # main and manual runs stay full whatever the range: they are the qualification path.
        for event, ref in (("push", "main"), ("workflow_dispatch", "dev"), ("workflow_dispatch", "main"), ("push", None)):
            with self.subTest(event=event, ref=ref):
                self.assertEqual(self.detect(event=event, before=self.base, ref=ref), FULL - {"adrs"})

    def push_to_dev(self, before=None, summary=None):
        return self.detect(event="push", base="", before=self.base if before is None else before, ref="dev", summary=summary)

    def test_push_to_dev_without_an_ios_path_skips_only_ios(self):
        summary = Path(self.temp.name) / "summary.md"
        for path in ("services/api/src/Main.java", "apps/admin-web/src/App.tsx", "firmware/bench/sketch.ino",
                     "docs/notes.md", "docs/cahier-conception/10-contrats-mqtt.md", "infra/docker/compose.yaml"):
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                head = self.repo.commit({path: f"{path}\n"})
                self.assertEqual(self.push_to_dev(summary=summary), FULL - {"adrs", "ios"})
                self.assertIn(f"iOS skipped: no iOS path changed in {self.base[:7]}..{head[:7]}", summary.read_text(encoding="utf-8"))

    def test_push_to_dev_with_an_ios_path_runs_the_full_ios_suite(self):
        for path in ("apps/ios/AegisMobile/View.swift", "apps/ios/AegisMobile.xcodeproj/project.pbxproj",
                     "apps/ios/Config/Shared.xcconfig", "apps/ios/scripts/ios-test.sh",
                     "apps/ios/AegisMobile.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
                     "docs/cahier-conception/09-corpus-recherche-q.json", "docs/cahier-conception/09-contrats-rest.md",
                     ".github/workflows/ci.yml", ".github/scripts/ci-result.py", ".github/scripts/new-tool.sh"):
            with self.subTest(path=path):
                self.base = self.repo.git("rev-parse", "HEAD")
                self.repo.commit({path: f"{path}\n"})
                # Never the fast recipe on a push: the full standalone suite qualifies the merged branch.
                self.assertEqual(self.push_to_dev(), FULL - {"adrs"})

    def test_push_to_dev_counts_an_ios_file_deleted_or_moved_away(self):
        self.repo.commit({"apps/ios/AegisMobile/Old.swift": "a\n" * 20})
        self.base = self.repo.git("rev-parse", "HEAD")
        self.repo.commit({}, delete=["apps/ios/AegisMobile/Old.swift"])
        self.assertIn("ios", self.push_to_dev())
        self.repo.commit({"apps/ios/AegisMobile/Moved.swift": "b\n" * 20})
        self.base = self.repo.git("rev-parse", "HEAD")
        (self.repo.folder / "attic").mkdir()
        self.repo.git("mv", "apps/ios/AegisMobile/Moved.swift", "attic/Moved.swift")
        self.repo.git("commit", "-q", "-m", "move")
        self.assertIn("ios", self.push_to_dev())

    def test_push_to_dev_with_an_unproven_range_runs_ios(self):
        self.repo.commit({"docs/notes.md": "x\n"})
        side = self.repo.git("rev-parse", "HEAD~1")
        self.repo.git("checkout", "-q", "-b", "side", side)
        rewritten = self.repo.commit({"docs/other.md": "y\n"})
        self.repo.git("checkout", "-q", "main")
        for before in ("", "0" * 40, "f" * 40, rewritten):
            with self.subTest(before=before):
                self.assertEqual(self.push_to_dev(before=before), FULL - {"adrs"})

    def test_stacked_pull_request_names_the_commits_that_select_ios(self):
        summary = Path(self.temp.name) / "summary.md"
        prerequisite = self.repo.commit({"apps/ios/AegisMobile/View.swift": "a\n"}, message="fix(ios): prerequisite")
        self.repo.commit({"docs/notes.md": "x\n"}, message="docs: own change")
        self.assertEqual(self.detect(summary=summary), {"ios", "agents"})
        text = summary.read_text(encoding="utf-8")
        self.assertIn(f"- {prerequisite[:7]} fix(ios): prerequisite", text)
        self.assertNotIn("own change", text)

    def test_no_ios_attribution_without_an_ios_change(self):
        summary = Path(self.temp.name) / "summary.md"
        self.repo.commit({"docs/notes.md": "x\n"})
        self.assertEqual(self.detect(summary=summary), {"agents"})
        self.assertFalse(summary.exists())

    def test_unreadable_pull_request_diff_runs_everything(self):
        self.repo.commit({"docs/notes.md": "x\n"})
        self.assertEqual(self.detect(base=""), FULL)
        self.assertEqual(self.detect(base="0" * 40), FULL)


class CiResultTests(unittest.TestCase):
    def result(self, changes, *jobs):
        return run([sys.executable, str(SCRIPTS / "ci-result.py"), changes, *jobs])

    def assertBlocks(self, changes, *jobs):
        result = self.result(changes, *jobs)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("::error::", result.stdout)

    def test_needed_success_and_unneeded_skip_pass(self):
        result = self.result("success", "API tests=true:success", "Web checks=false:skipped")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_needed_job_must_succeed(self):
        for outcome in ("failure", "cancelled", "skipped", ""):
            with self.subTest(outcome=outcome):
                self.assertBlocks("success", f"Simulator tests=true:{outcome}", "API tests=true:success")

    def test_missing_or_invalid_needed_flag_blocks(self):
        for flag in ("", "TRUE", "yes"):
            with self.subTest(flag=flag):
                self.assertBlocks("success", f"iOS standalone tests={flag}:skipped")

    def test_unneeded_job_that_failed_still_blocks(self):
        for outcome in ("failure", "cancelled", ""):
            with self.subTest(outcome=outcome):
                self.assertBlocks("success", f"Web checks=false:{outcome}")

    def test_change_detection_must_succeed(self):
        for outcome in ("failure", "cancelled", "skipped", ""):
            with self.subTest(outcome=outcome):
                self.assertBlocks(outcome, "API tests=false:skipped")

    def test_each_failing_job_is_named(self):
        result = self.result("success", "API tests=true:failure", "Agent setup validator=true:cancelled")
        self.assertEqual(result.returncode, 1)
        self.assertIn("API tests: it was required and ended as 'failure'", result.stdout)
        self.assertIn("Agent setup validator: it was required and ended as 'cancelled'", result.stdout)

    def test_malformed_arguments_are_refused(self):
        self.assertEqual(self.result("success").returncode, 2)
        self.assertEqual(self.result("success", "API tests").returncode, 2)

    def test_step_summary_lists_every_job(self):
        with tempfile.TemporaryDirectory() as folder:
            summary = Path(folder) / "summary.md"
            result = run([sys.executable, str(SCRIPTS / "ci-result.py"), "success",
                          "API tests=true:success", "Web checks=false:skipped"],
                         env={"GITHUB_STEP_SUMMARY": str(summary)})
            self.assertEqual(result.returncode, 0)
            text = summary.read_text(encoding="utf-8")
            self.assertIn("| API tests | true | success | ok |", text)
            self.assertIn("| Web checks | false | skipped | ok |", text)


JUNIT_PASS = '<testsuites><testsuite name="a"><testcase name="one"/><testcase name="two"/></testsuite></testsuites>'
JUNIT_SKIP = '<testsuite><testcase name="one"><skipped/></testcase></testsuite>'
JUNIT_FAIL = '<testsuite><testcase name="one"><failure/></testcase><testcase name="two"><error/></testcase></testsuite>'
JUNIT_EMPTY = '<testsuites><testsuite name="empty" tests="0"/></testsuites>'


class TestReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def report(self, *contents, summary=None):
        paths = []
        for index, content in enumerate(contents):
            path = self.folder / f"report-{index}.xml"
            path.write_text(content, encoding="utf-8")
            paths.append(str(path))
        env = {"GITHUB_STEP_SUMMARY": str(summary)} if summary else {}
        return run([sys.executable, str(SCRIPTS / "test-report.py"), "Suite", *paths], env=env)

    def test_passing_reports_print_observed_counts(self):
        summary = self.folder / "summary.md"
        result = self.report(JUNIT_PASS, JUNIT_PASS, summary=summary)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Suite: 4 run, 4 passed, 0 failed, 0 skipped", result.stdout)
        self.assertIn("report-0.xml: 2 run, 2 passed", result.stdout)
        self.assertIn("| **Total (2 reports)** | 4 | 4 | 0 | 0 |", summary.read_text(encoding="utf-8"))

    def test_skipped_only_suite_fails(self):
        result = self.report(JUNIT_SKIP)
        self.assertEqual(result.returncode, 1)
        self.assertIn("1 skipped", result.stdout)

    def test_failures_and_errors_fail(self):
        result = self.report(JUNIT_FAIL)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Suite: 2 run, 0 passed, 2 failed, 0 skipped", result.stdout)

    def test_empty_suite_fails_even_beside_a_passing_one(self):
        result = self.report(JUNIT_PASS, JUNIT_EMPTY)
        self.assertEqual(result.returncode, 1)
        self.assertIn("no test ran in report-1.xml", result.stdout)

    def test_missing_or_corrupt_report_fails(self):
        result = run([sys.executable, str(SCRIPTS / "test-report.py"), "Suite", str(self.folder / "absent.xml")])
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot read", result.stdout)
        self.assertEqual(self.report("<testsuite>").returncode, 1)


ACCEPTED_ADR = "# ADR-001\n\n**Statut :** ACCEPTED\n\nDecision.\n"
PROPOSED_ADR = "# ADR-002\n\n**Statut :** PROPOSED\n\nIdea.\n"
REGISTER = "docs/cahier-conception/13-registre-adrs-proposes.md"
REGISTER_TEXT = (
    "# Register\n\n"
    "## ADR-001 — Kept\n\n**Statut :** `ACCEPTED` — decided.\n\nText.\n\n"
    "## ADR-003 — Open\n\n**Statut :** `PROPOSED` — open.\n\nText.\n"
)


class AcceptedAdrGuardTests(unittest.TestCase):
    """Runs the guard on synthetic history; the repository's own ADRs are never touched."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = GitRepository(self.temp.name)
        hook = (ROOT / ".githooks" / "check-accepted-adrs").read_text(encoding="utf-8")
        self.base = self.repo.commit({
            ".githooks/check-accepted-adrs": hook,
            "docs/adr/ADR-001-kept.md": ACCEPTED_ADR,
            "docs/adr/ADR-002-open.md": PROPOSED_ADR,
            REGISTER: REGISTER_TEXT,
        })

    def tearDown(self):
        self.temp.cleanup()

    def guard(self):
        env = {"BASE_SHA": self.base, "HEAD_SHA": self.repo.git("rev-parse", "HEAD")}
        return run([sys.executable, str(SCRIPTS / "check-accepted-adrs.py")], cwd=self.repo.folder, env=env)

    def assertRefused(self, fragment):
        result = self.guard()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(fragment, result.stdout)

    def test_allowed_changes_pass(self):
        self.repo.commit({
            "docs/adr/ADR-002-open.md": PROPOSED_ADR + "More.\n",
            "docs/adr/ADR-014-new.md": ACCEPTED_ADR.replace("001", "014"),
            REGISTER: REGISTER_TEXT + "More on ADR-003.\n",
        })
        result = self.guard()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_edited_accepted_adr_is_refused(self):
        self.repo.commit({"docs/adr/ADR-001-kept.md": ACCEPTED_ADR + "Edited.\n"})
        self.assertRefused("docs/adr/ADR-001-kept.md (accepted ADR)")

    def test_deleted_or_renamed_accepted_adr_is_refused(self):
        self.repo.commit({"docs/adr/ADR-001-renamed.md": ACCEPTED_ADR}, delete=["docs/adr/ADR-001-kept.md"])
        self.assertRefused("docs/adr/ADR-001-kept.md (accepted ADR)")

    def test_edited_accepted_register_fiche_is_refused(self):
        self.repo.commit({REGISTER: REGISTER_TEXT.replace("decided.", "changed.")})
        self.assertRefused("fiche ADR-001 (accepted)")

    def test_duplicated_accepted_fiche_heading_is_refused(self):
        self.repo.commit({REGISTER: REGISTER_TEXT + "\n## ADR-001 — Shadow\n\nOther.\n"})
        self.assertRefused("fiche ADR-001")

    def test_weakened_hook_in_the_pull_request_is_not_used(self):
        self.repo.commit({
            ".githooks/check-accepted-adrs": "ADR_DIR = 'nowhere/'\nREGISTER = 'none'\n",
            "docs/adr/ADR-001-kept.md": ACCEPTED_ADR + "Edited.\n",
        })
        self.assertRefused("docs/adr/ADR-001-kept.md (accepted ADR)")

    def test_missing_shas_fail(self):
        result = run([sys.executable, str(SCRIPTS / "check-accepted-adrs.py")], cwd=self.repo.folder,
                     env={"BASE_SHA": "", "HEAD_SHA": ""})
        self.assertEqual(result.returncode, 1)


class XcresultSummaryTests(unittest.TestCase):
    """Only the path that needs no Xcode: run on Linux, it must not report success without a bundle."""

    def test_no_bundle_is_not_a_success(self):
        results = ROOT / "apps" / "ios" / "build" / "results"
        if results.exists() and any(results.glob("*.xcresult")):
            self.skipTest("a local result bundle exists")
        result = run([sys.executable, str(SCRIPTS / "xcresult-summary.py")])
        self.assertEqual(result.returncode, 1)
        self.assertIn("no .xcresult bundle", result.stdout)

    def summary_module(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("xcresult_summary", SCRIPTS / "xcresult-summary.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_load_summary_reports_the_peak_after_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            results = Path(folder)
            (results / "simulator-boot.txt").write_text("ready_epoch=100\n", encoding="utf-8")
            (results / "simulator-load.tsv").write_text(
                "epoch\tload1\tsimulator_processes\tsimulator_cpu_percent\n"
                "101\t3.50\t40\t80.0\n111\t9.25\t55\t300.0\nbroken line\n121\t2.00\t50\t10.0\n",
                encoding="utf-8")
            line = self.summary_module().load_summary(results)
        self.assertEqual(line, "Simulator load: 3 samples over 20 s; load1 3.50 at the first sample, "
                               "peak 9.25 at +11 s after ready, 2.00 at the last; simulator processes 40 to 55")

    def test_load_summary_is_silent_without_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            module = self.summary_module()
            self.assertIsNone(module.load_summary(Path(folder)))
            (Path(folder) / "simulator-load.tsv").write_text("epoch\tload1\n", encoding="utf-8")
            self.assertEqual(module.load_summary(Path(folder)), "Simulator load: no readable sample")


class SimulatorLoadTests(unittest.TestCase):
    """The sampler of #67 measures only: bounded, tolerant, never failing the job."""

    def test_samples_until_its_bound_and_succeeds(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "load.tsv"
            result = run(["bash", str(SCRIPTS / "simulator-load.sh"), "NO-SUCH-UDID", str(out), "3", "1"])
            self.assertEqual(result.returncode, 0, result.stderr)
            lines = out.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines[0], "epoch\tload1\tsimulator_processes\tsimulator_cpu_percent")
        # The bound is in whole seconds from a start anywhere within a second, so
        # 3 s at 1 s gives 2 to 4 samples: it repeats, and it stops at its bound.
        self.assertGreaterEqual(len(lines) - 1, 2)
        self.assertLessEqual(len(lines) - 1, 4)
        for line in lines[1:]:
            epoch, load, count, cpu = line.split("\t")
            self.assertTrue(epoch.isdigit())
            float(load)
            self.assertEqual(count, "0")
            self.assertEqual(cpu, "0.0")

    def test_the_job_starts_it_in_the_background_and_never_waits(self):
        text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        ios = text[text.index("  ios:\n"):text.index("  scripts:\n")]
        boot = ios[ios.index("- name: Boot the simulator"):ios.index("- name: Choose the recipe")]
        start = boot.index("simulator-load.sh")
        self.assertGreater(start, boot.index("xcrun simctl bootstatus"))
        self.assertTrue(boot[start:].split("\n", 1)[0].rstrip().endswith("&"))
        self.assertNotIn("wait", boot[start:])
        self.assertNotIn("sleep", boot)
        recipe_and_after = ios[ios.index("- name: Choose the recipe"):]
        self.assertNotIn("simulator-load", recipe_and_after)
        self.assertIn("path: apps/ios/build/results/", ios)


class WorkflowWiringTests(unittest.TestCase):
    """Cheap guards on ci.yml that a YAML parser alone would not catch."""

    def setUp(self):
        self.text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    def test_every_component_output_is_exported(self):
        for name in COMPONENTS:
            self.assertIn(f"{name}: ${{{{ steps.filter.outputs.{name} }}}}", self.text)

    def test_ios_uses_the_shared_destination_script(self):
        self.assertIn("scripts/ios-destination.sh", self.text)
        self.assertNotIn("simctl list devices available -j", self.text)

    def test_concurrency_groups_by_branch_and_keeps_pushes_apart(self):
        block = self.text[self.text.index("concurrency:\n"):self.text.index("\njobs:")]
        # Pull request and manual runs of one branch share a group: they never
        # run side by side. The pull request number would separate them.
        self.assertIn("github.head_ref || github.ref_name", block)
        self.assertIn("github.event.pull_request.head.repo.full_name || github.repository", block)
        self.assertNotIn("pull_request.number", block)
        self.assertIn("github.event_name == 'push' && 'push' || 'branch'", block)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", block)

    def test_ios_boots_the_simulator_within_a_bound_before_the_tests(self):
        ios = self.text[self.text.index("  ios:\n"):self.text.index("  scripts:\n")]
        boot = ios.index("- name: Boot the simulator")
        self.assertLess(ios.index("- name: Choose a simulator"), boot)
        self.assertLess(boot, ios.index("- name: iOS recipe"))
        step = ios[boot:ios.index("- name: iOS recipe")]
        self.assertIn("timeout-minutes: 8", step)
        self.assertIn("xcrun simctl bootstatus", step)

    def test_ios_job_is_bounded_at_45_minutes_with_only_the_bounded_retry(self):
        ios = self.text[self.text.index("  ios:\n"):self.text.index("  scripts:\n")]
        job = ios[:ios.index("    steps:\n")]
        # The job limit is a capacity bound (#67): 30 min cancelled complete
        # green runs of about 312 tests. The only retry is ios-retry.py, once,
        # for failed UI tests (Philippe, 25 November); no xcodebuild repetition.
        self.assertIn("    timeout-minutes: 45\n", job)
        self.assertNotIn("timeout-minutes: 30", ios)
        self.assertNotIn("continue-on-error", self.text)
        recipe = (ROOT / "apps/ios/scripts/ios-test.sh").read_text()
        for forbidden in ("-retry-tests-on-failure", "-test-iterations", "-run-tests-until-failure",
                          "-test-repetition-relaunch-enabled"):
            self.assertNotIn(forbidden, ios)
            self.assertNotIn(forbidden, recipe)
        self.assertNotIn("retry", recipe)
        step = ios[ios.index("- name: iOS recipe"):ios.index("- name: Result summary")]
        self.assertIn('run: scripts/ios-test.sh "$IOS_RECIPE" || '
                      'python3 ../../.github/scripts/ios-retry.py "$IOS_RECIPE"\n', step)
        self.assertEqual(self.text.count("ios-retry.py"), 1)

    def test_api_tests_start_the_development_broker_first(self):
        api = self.text.split("\n  api:\n", 1)[1].split("\n  web:\n", 1)[0]
        broker = api.index("up -d --wait mosquitto")
        self.assertIn("--env-file infra/docker/.env.example", api)
        self.assertLess(broker, api.index("./mvnw -B -ntp test"))
        self.assertIn("logs mosquitto", api)

    def test_ci_result_always_runs_and_uses_the_aggregator(self):
        result = self.text[self.text.index("  result:\n"):]
        self.assertIn("if: always()", result)
        self.assertIn(".github/scripts/ci-result.py", result)

    def test_every_required_job_reaches_the_aggregator(self):
        result = self.text[self.text.index("  result:\n"):]
        needs = re.search(r"needs: \[([^\]]*)\]", result).group(1)
        for job in (name.strip() for name in needs.split(",")):
            if job == "changes":
                self.assertIn("${{ needs.changes.result }}", result)
                continue
            with self.subTest(job=job):
                value = f"${{{{ needs.changes.outputs.{job} }}}}:${{{{ needs.{job}.result }}}}"
                variable = re.search(rf"^ +(\w+): {re.escape(value)}$", result, re.M)
                self.assertIsNotNone(variable, f"{job} is not exported to the aggregator step")
                command = result[result.index("run:"):]
                self.assertRegex(command, rf'"[^"=]+=\${variable.group(1)}"', f"{job} is not passed to ci-result.py")

    def test_every_job_outside_the_aggregator_is_named_in_its_summary(self):
        result = self.text[self.text.index("  result:\n"):]
        needs = {name.strip() for name in re.search(r"needs: \[([^\]]*)\]", result).group(1).split(",")}
        note = result[result.index("- name: Jobs outside CI result"):]
        jobs = re.findall(r"^  (\w+):\n    name: (.+)$", self.text, re.M)
        outside = [(job, name) for job, name in jobs if job not in needs and job != "result"]
        self.assertTrue(outside)
        for job, name in outside:
            with self.subTest(job=job):
                self.assertIn(name, note, f"{name} is outside CI result but not named in its summary")

    def test_change_detection_receives_the_pushed_range(self):
        step = self.text[self.text.index("      - id: filter\n"):self.text.index("changed-components.sh")]
        self.assertIn("BEFORE_SHA: ${{ github.event.before }}", step)
        self.assertIn("REF_NAME: ${{ github.ref_name }}", step)
        self.assertIn("HEAD_SHA: ${{ github.sha }}", step)

    def test_ios_is_gated_by_its_output_and_counts_in_ci_result(self):
        # The executed iOS result counts in CI result (Philippe, 25 November);
        # a skip by the change filter stays legitimate: iOS=false:skipped passes.
        ios = self.text[self.text.index("  ios:\n"):self.text.index("  scripts:\n")]
        self.assertIn("if: needs.changes.outputs.ios == 'true'", ios)
        result = self.text[self.text.index("  result:\n"):]
        needs = {name.strip() for name in re.search(r"needs: \[([^\]]*)\]", result).group(1).split(",")}
        self.assertIn("ios", needs)
        self.assertIn('"iOS tests=$IOS"', result)
        self.assertIn("workflow_dispatch:", self.text[:self.text.index("permissions:")])

    def test_ios_runs_the_chosen_recipe_and_defaults_to_standalone(self):
        ios = self.text[self.text.index("  ios:\n"):self.text.index("  scripts:\n")]
        choose = ios[ios.index("- name: Choose the recipe"):ios.index("- name: iOS recipe")]
        self.assertLess(ios.index("- name: Boot the simulator"), ios.index("- name: Choose the recipe"))
        self.assertIn("${{ needs.changes.outputs.ios_fast }}", choose)
        self.assertIn("recipe=standalone\n", choose)
        self.assertIn("recipe=pr\n", choose)
        self.assertIn('scripts/ios-test.sh "$IOS_RECIPE"', ios)
        self.assertNotIn("ios-test.sh standalone", ios)


def xcresult_tests(cases):
    """A `test-results tests` document with (bundle kind, bundle, Class/test(), result) cases."""
    bundles = {}
    for kind, bundle, case, result in cases:
        node = {"nodeType": "Test Case", "nodeIdentifier": case, "name": case.split("/")[-1], "result": result,
                "children": [{"nodeType": "Failure Message", "name": f"{case} failed"}] if result == "Failed" else []}
        bundles.setdefault((kind, bundle), []).append(node)
    return {"testNodes": [{"nodeType": "Test Plan", "children": [
        {"nodeType": kind, "name": bundle, "children": [{"nodeType": "Test Suite", "children": nodes}]}
        for (kind, bundle), nodes in bundles.items()]}]}


class IosRetryTests(unittest.TestCase):
    """#67, Philippe 25 November: at most two attempts, failed UI tests only, persistent failure blocks."""

    UI, UNIT = "UI test bundle", "Unit test bundle"
    FLAKY = ("UI test bundle", "AegisMobileUITests", "CatalogUITests/testOffline()", "Failed")

    def attempt(self, recipe="standalone", first=None, problems=("failures",), retry=None, failed=None):
        """Run ios-retry.py against stubs; retry is the retry bundle's cases, or None for no bundle."""
        first = [self.FLAKY] if first is None else first
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            results, stubs, data = folder / "build/results", folder / "bin", folder / "data"
            for path in (results, stubs, data, folder / "scripts"):
                path.mkdir(parents=True)
            (results / f"{recipe}.xcresult").mkdir()
            failures = sum(case[3] == "Failed" for case in first) if failed is None else failed
            (results / f"{recipe}-summary.json").write_text(json.dumps(
                {"problems": list(problems), "total": 335, "passed": 335 - failures, "failed": failures,
                 "skipped": 0}))
            (data / f"{recipe}.xcresult.tests").write_text(json.dumps(xcresult_tests(first)))
            if retry is not None:
                passed = sum(case[3] == "Passed" for case in retry)
                (data / f"{recipe}-retry.xcresult.tests").write_text(json.dumps(xcresult_tests(retry)))
                (data / f"{recipe}-retry.xcresult.summary").write_text(json.dumps(
                    {"totalTestCount": len(retry), "passedTests": passed, "failedTests": len(retry) - passed,
                     "skippedTests": 0, "result": "Passed" if passed == len(retry) else "Failed"}))
            log = folder / "calls.log"
            (stubs / "xcrun").write_text(
                "#!/bin/bash\n"
                f"echo \"xcrun $*\" >> {log}\n"
                "while (( $# )); do [[ $1 == --path ]] && bundle=$2; [[ $1 == tests || $1 == summary ]] && kind=$1; shift; done\n"
                f"cat {data}/$(basename \"$bundle\").$kind\n")
            (stubs / "xcodebuild").write_text(
                "#!/bin/bash\n"
                f"echo \"xcodebuild $*\" >> {log}\n"
                f"[[ -f {data}/{recipe}-retry.xcresult.tests ]] || exit 65\n"
                "while (( $# )); do [[ $1 == -resultBundlePath ]] && mkdir -p \"$2\"; shift; done\n"
                "exit 65\n")
            (folder / "scripts/check-strings.py").write_text(f"open({str(log)!r}, 'a').write('check-strings\\n')\n")
            for stub in stubs.iterdir():
                stub.chmod(0o755)
            env = {"PATH": f"{stubs}:{os.environ['PATH']}", "IOS_RESULTS_DIR": str(results)}
            result = run([sys.executable, str(SCRIPTS / "ios-retry.py"), recipe], cwd=folder, env=env)
            calls = log.read_text().splitlines() if log.exists() else []
            attempts = results / f"{recipe}-attempts.json"
            record = json.loads(attempts.read_text()) if attempts.exists() else None
            kept = (results / f"{recipe}.xcresult").is_dir()
        builds = [call for call in calls if call.startswith("xcodebuild")]
        return result, builds, record, calls, kept

    def test_a_ui_test_that_passes_on_its_second_attempt_is_reported_apart(self):
        result, builds, record, calls, kept = self.attempt(retry=[self.FLAKY[:3] + ("Passed",)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(builds), 1)
        self.assertTrue(builds[0].startswith("xcodebuild test-without-building "))
        self.assertIn("-only-testing:AegisMobileUITests/CatalogUITests/testOffline", builds[0])
        self.assertEqual(builds[0].count("-only-testing:"), 1)
        self.assertNotIn("-retry-tests-on-failure", builds[0])
        self.assertNotIn("-test-iterations", builds[0])
        self.assertEqual(record["maxAttempts"], 2)
        self.assertEqual(record["passedFirstAttempt"], 334)
        self.assertEqual(record["passedAfterRetry"], ["AegisMobileUITests/CatalogUITests/testOffline"])
        self.assertEqual(record["persistentFailures"], [])
        self.assertIn("CatalogUITests/testOffline() failed", str(record["firstFailures"]))
        self.assertIn("QA must review each first failure", result.stdout)
        self.assertIn("check-strings", calls)
        self.assertTrue(kept)

    def test_a_persistent_failure_blocks_after_exactly_two_attempts(self):
        result, builds, record, calls, kept = self.attempt(retry=[self.FLAKY])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(builds), 1)
        self.assertEqual(record["persistentFailures"], ["AegisMobileUITests/CatalogUITests/testOffline"])
        self.assertEqual(record["passedAfterRetry"], [])
        self.assertIn("::error::", result.stdout)
        self.assertNotIn("check-strings", calls)
        self.assertTrue(kept)

    def test_a_retry_that_leaves_no_bundle_blocks(self):
        result, builds, record, _, _ = self.attempt(retry=None)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(builds), 1)
        self.assertEqual(record["persistentFailures"], ["AegisMobileUITests/CatalogUITests/testOffline"])

    def test_extended_retries_without_the_string_check(self):
        result, builds, _, calls, _ = self.attempt("extended", retry=[self.FLAKY[:3] + ("Passed",)])
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(len(builds), 1)
        self.assertNotIn("check-strings", calls)

    def test_nothing_is_retried_outside_the_allowed_cases(self):
        unit = (self.UNIT, "AegisMobileTests", "ActivityTests/testRead()", "Failed")
        many = [(self.UI, "AegisMobileUITests", f"CatalogUITests/test{n}()", "Failed") for n in range(4)]
        unnamed = (self.UI, "AegisMobileUITests", "CatalogUITests/testWith(argument:)", "Failed")
        cases = {
            "unit test": dict(first=[self.FLAKY, unit]),
            "more than three UI tests": dict(first=many),
            "skipped tests": dict(problems=("failures", "skipped tests are not accepted")),
            "no failure counted": dict(problems=("no test ran",)),
            "count mismatch": dict(failed=2),
            "unnamed case": dict(first=[unnamed]),
            "live recipe": dict(recipe="live"),
        }
        for label, options in cases.items():
            with self.subTest(label):
                result, builds, record, _, _ = self.attempt(retry=[self.FLAKY[:3] + ("Passed",)], **options)
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertEqual(builds, [])
                if label != "live recipe":
                    self.assertTrue(record["refused"])

    def test_the_ci_result_counts_an_executed_ios_job_and_accepts_its_legitimate_skip(self):
        ci = SCRIPTS / "ci-result.py"
        self.assertEqual(run([sys.executable, str(ci), "success", "iOS tests=false:skipped"]).returncode, 0)
        self.assertEqual(run([sys.executable, str(ci), "success", "iOS tests=true:success"]).returncode, 0)
        for outcome in ("failure", "cancelled", "skipped", ""):
            with self.subTest(outcome=outcome):
                self.assertEqual(run([sys.executable, str(ci), "success", f"iOS tests=true:{outcome}"]).returncode, 1)


if __name__ == "__main__":
    unittest.main()
