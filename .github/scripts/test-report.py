#!/usr/bin/env python3
"""Summarise JUnit XML reports and fail when a suite proves nothing.

Usage: test-report.py <label> <report.xml> [<report.xml> ...]

Writes the run, passed, failed and skipped counts to the log and, on GitHub,
to the step summary. Exits 1 when a report is missing or unreadable, when no
test ran, or when any test failed or was skipped: a skipped test hides missing
setup (for example an absent broker password), so it never counts as a pass.
"""

import os
import sys
import xml.etree.ElementTree as ET


def counts(path):
    total = failed = skipped = 0
    # Every test case at any depth: suites may nest (<testsuites><testsuite>…).
    for case in ET.parse(path).getroot().iter("testcase"):
        total += 1
        if case.find("failure") is not None or case.find("error") is not None:
            failed += 1
        elif case.find("skipped") is not None:
            skipped += 1
    return total, failed, skipped


def main(argv):
    if len(argv) < 3:
        print("usage: test-report.py <label> <report.xml> [...]", file=sys.stderr)
        return 2
    label, paths = argv[1], argv[2:]
    total = failed = skipped = 0
    problems = []
    for path in paths:
        try:
            run, bad, skip = counts(path)
        except (OSError, ET.ParseError) as error:
            problems.append(f"cannot read {path}: {error}")
            continue
        total, failed, skipped = total + run, failed + bad, skipped + skip
    passed = total - failed - skipped
    if total == 0:
        problems.append("no test ran")
    if failed:
        problems.append(f"{failed} failed")
    if skipped:
        problems.append(f"{skipped} skipped")

    line = f"{label}: {total} run, {passed} passed, {failed} failed, {skipped} skipped"
    print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"### {label}\n\n| Run | Passed | Failed | Skipped |\n|---:|---:|---:|---:|\n")
            out.write(f"| {total} | {passed} | {failed} | {skipped} |\n\n")
            for problem in problems:
                out.write(f"- **{problem}**\n")
    for problem in problems:
        print(f"::error::{label}: {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
