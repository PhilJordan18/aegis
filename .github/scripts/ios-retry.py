#!/usr/bin/env python3
"""Retry, once, only the UI tests that failed in an iOS recipe (#67).

Decision of Philippe, 25 November 2026: on hosted runners, a UI test may get
one more attempt, two attempts in total, on the same build. A persistent
failure blocks. A pass on the second attempt does not clear the product: QA
reviews every first failure before a PASS, from the first attempt's bundle,
which is kept unchanged next to the retry bundle.

Run from apps/ios after `scripts/ios-test.sh RECIPE` failed:

    scripts/ios-test.sh "$RECIPE" || python3 ../../.github/scripts/ios-retry.py "$RECIPE"

It retries nothing, and exits non-zero, unless every condition holds:
- the recipe is standalone, pr or extended (never live);
- the recipe's only problem was failing tests (no skipped test, no empty run,
  no missing bundle);
- every failed test is in a UI test bundle, and there are at most
  MAX_RETRIED_TESTS of them;
- the failed tests can be named exactly.

The retry runs `xcodebuild test-without-building` on the build products of the
first attempt with -only-testing for those tests, once. It never rebuilds,
never reruns the suite, and never retries the retry.

Environment: IOS_DESTINATION, IOS_DERIVED_DATA, IOS_RESULTS_DIR, as for
ios-test.sh, and GITHUB_STEP_SUMMARY under GitHub Actions.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

RECIPES = {"standalone", "pr", "extended"}
STRING_CHECK = {"standalone", "pr"}
MAX_ATTEMPTS = 2
MAX_RETRIED_TESTS = 3
UI_BUNDLE = "UI test bundle"


def xcresult(kind, bundle):
    output = subprocess.run(
        ["xcrun", "xcresulttool", "get", "test-results", kind, "--path", str(bundle), "--compact"],
        capture_output=True, text=True, check=True).stdout
    return json.loads(output)


def failed_cases(tests):
    """[(identifier, in_ui_bundle, messages)] of the failed test cases, or None if one cannot be named."""
    found = []

    def walk(node, bundle, ui):
        kind = node.get("nodeType")
        if kind in (UI_BUNDLE, "Unit test bundle"):
            bundle, ui = node.get("name"), kind == UI_BUNDLE
        if kind == "Test Case":
            if node.get("result") == "Failed":
                case = node.get("nodeIdentifier") or ""
                messages = [child.get("name", "") for child in node.get("children", [])
                            if child.get("nodeType") == "Failure Message"]
                # XCTest case identifiers read "Class/testName()"; anything else cannot be retried exactly.
                match = re.fullmatch(r"(\w+)/(\w+)\(\)", case)
                found.append((f"{bundle}/{match.group(1)}/{match.group(2)}" if match and bundle else None,
                              ui, messages))
            return
        for child in node.get("children", []):
            walk(child, bundle, ui)

    for node in tests.get("testNodes", []):
        walk(node, None, False)
    return found


def report(recipe, record, results):
    with open(results / f"{recipe}-attempts.json", "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
        handle.write("\n")
    lines = [f"### iOS {recipe}: attempts (max {MAX_ATTEMPTS}, failed UI tests only)", ""]
    if record.get("refused"):
        lines.append(f"No retry: {record['refused']}.")
    else:
        lines += [f"- Passed on the first attempt: **{record['passedFirstAttempt']}**",
                  f"- Passed only on the second attempt: **{len(record['passedAfterRetry'])}**"
                  + "".join(f"\n  - `{t}`" for t in record["passedAfterRetry"]),
                  f"- Failed on both attempts: **{len(record['persistentFailures'])}**"
                  + "".join(f"\n  - `{t}`" for t in record["persistentFailures"]),
                  "",
                  "First attempt kept in "
                  f"`{recipe}.xcresult`, retry in `{recipe}-retry.xcresult`."]
        if record["passedAfterRetry"]:
            lines.append("**QA must review each first failure before a PASS: "
                         "a pass on the second attempt does not clear the product.**")
    text = "\n".join(lines) + "\n\n"
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text)


def refuse(recipe, results, reason, record=None):
    record = dict(record or {}, recipe=recipe, maxAttempts=MAX_ATTEMPTS, refused=reason)
    report(recipe, record, results)
    print(f"::error::iOS {recipe}: no retry, {reason}")
    return 1


def main(argv):
    if len(argv) != 2:
        print("usage: ios-retry.py standalone|pr|extended", file=sys.stderr)
        return 64
    recipe = argv[1]
    results = Path(os.environ.get("IOS_RESULTS_DIR", "build/results"))
    if recipe not in RECIPES:
        print(f"::error::iOS {recipe}: this recipe is never retried")
        return 1
    bundle, summary_file = results / f"{recipe}.xcresult", results / f"{recipe}-summary.json"
    if not bundle.is_dir() or not summary_file.is_file():
        return refuse(recipe, results, "the first attempt left no result bundle or summary")
    first = json.loads(summary_file.read_text(encoding="utf-8"))
    if first.get("problems") != ["failures"] or not first.get("failed"):
        return refuse(recipe, results, f"the first attempt's problems were {first.get('problems')}")

    cases = failed_cases(xcresult("tests", bundle))
    record = {"firstAttempt": {k: first.get(k) for k in ("total", "passed", "failed", "skipped")},
              "firstFailures": {str(name): messages for name, _, messages in cases}}
    if len(cases) != first["failed"]:
        return refuse(recipe, results, f"{len(cases)} failed cases found for {first['failed']} failed tests", record)
    if any(name is None for name, _, _ in cases):
        return refuse(recipe, results, "a failed test cannot be named exactly", record)
    if not all(ui for _, ui, _ in cases):
        return refuse(recipe, results, "a unit test failed; only UI tests are retried", record)
    if len(cases) > MAX_RETRIED_TESTS:
        return refuse(recipe, results, f"{len(cases)} UI tests failed, more than {MAX_RETRIED_TESTS}", record)

    retried = [name for name, _, _ in cases]
    for name in retried:
        print(f"::warning::iOS {recipe}: {name} failed on the first attempt; retrying it once")
    retry_bundle = results / f"{recipe}-retry.xcresult"
    command = ["xcodebuild", "test-without-building",
               "-project", "AegisMobile.xcodeproj", "-scheme", "AegisMobile", "-configuration", "Debug",
               "-destination", os.environ.get("IOS_DESTINATION",
                                              "platform=iOS Simulator,name=iPhone 17,OS=latest"),
               "-derivedDataPath", os.environ.get("IOS_DERIVED_DATA", "build/DerivedData"),
               "-resultBundlePath", str(retry_bundle),
               "-parallel-testing-enabled", "NO", "-quiet"]
    command += [f"-only-testing:{name}" for name in retried]
    subprocess.run(command, check=False)

    passed_again = []
    if retry_bundle.is_dir():
        second = xcresult("summary", retry_bundle)
        if (second.get("totalTestCount") == len(retried) and not second.get("skippedTests")
                and second.get("result") == "Passed" and second.get("passedTests") == len(retried)):
            passed_again = retried
        else:
            still = {name for name, _, _ in failed_cases(xcresult("tests", retry_bundle))}
            ran = second.get("totalTestCount") == len(retried) and not second.get("skippedTests")
            passed_again = [name for name in retried if ran and name not in still]
    record.update(recipe=recipe, maxAttempts=MAX_ATTEMPTS, retried=retried,
                  passedFirstAttempt=first["passed"], passedAfterRetry=passed_again,
                  persistentFailures=[name for name in retried if name not in passed_again])
    report(recipe, record, results)
    for name in record["persistentFailures"]:
        print(f"::error::iOS {recipe}: {name} failed on both attempts")
    if record["persistentFailures"]:
        return 1
    if recipe in STRING_CHECK:
        # ios-test.sh stops at its failed result check, before the String Catalog check.
        return subprocess.run([sys.executable, "scripts/check-strings.py",
                               os.environ.get("IOS_DERIVED_DATA", "build/DerivedData")]).returncode
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
