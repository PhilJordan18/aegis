"""Tests of the CI scripts in .github/scripts (standard library only).

Run from the repository root: python3 -m unittest discover -v -s .github/scripts/tests

Each test builds its own throwaway Git repository or report file under a
temporary directory; nothing in the checkout is modified.
"""

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / ".github" / "scripts"
COMPONENTS = ("api", "web", "simulator", "agents", "adrs", "ios", "ci")


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

    def detect(self, event="pull_request", base=None, head=None, summary=None):
        env = {"EVENT_NAME": event, "BASE_SHA": self.base if base is None else base,
               "HEAD_SHA": head or self.repo.git("rev-parse", "HEAD")}
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
                self.assertEqual(self.detect(), set(COMPONENTS))

    def test_known_ci_script_runs_its_tests_and_the_jobs_that_execute_it(self):
        cases = {
            ".github/scripts/tests/test_ci_scripts.py": {"ci"},
            ".github/scripts/changed-components.sh": {"ci"},
            ".github/scripts/ci-result.py": {"ci"},
            ".github/scripts/test-report.py": {"ci", "api", "web", "simulator"},
            ".github/scripts/xcresult-summary.py": {"ci", "ios"},
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
        for event in ("push", "workflow_dispatch"):
            with self.subTest(event=event):
                self.assertEqual(self.detect(event=event), set(COMPONENTS) - {"adrs"})

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
        self.assertEqual(self.detect(base=""), set(COMPONENTS))
        self.assertEqual(self.detect(base="0" * 40), set(COMPONENTS))


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
        self.assertLess(boot, ios.index("- name: Standalone recipe"))
        step = ios[boot:ios.index("- name: Standalone recipe")]
        self.assertIn("timeout-minutes: 8", step)
        self.assertIn("xcrun simctl bootstatus", step)

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


if __name__ == "__main__":
    unittest.main()
