#!/usr/bin/env python3
"""Summarise JUnit XML reports and fail when a suite proves nothing.

Usage: test-report.py <label> <report.xml> [<report.xml> ...]

Writes the observed run, passed, failed and skipped counts of each report and
their total to the log and, on GitHub, to the step summary; nothing is
compared with an expected total. Exits 1 when a report is missing or
unreadable, when a report holds no test case, or when any test failed or was
skipped: a skipped test hides missing setup (for example an absent broker
password), so it never counts as a pass.
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
    rows = []
    problems = []
    for path in paths:
        try:
            run, bad, skip = counts(path)
        except (OSError, ET.ParseError) as error:
            problems.append(f"cannot read {path}: {error}")
            continue
        if run == 0:
            problems.append(f"no test ran in {os.path.basename(path)}")
        rows.append((os.path.basename(path), run, run - bad - skip, bad, skip))
    total = sum(row[1] for row in rows)
    failed = sum(row[3] for row in rows)
    skipped = sum(row[4] for row in rows)
    passed = total - failed - skipped
    if total == 0:
        problems.append("no test ran")
    if failed:
        problems.append(f"{failed} failed")
    if skipped:
        problems.append(f"{skipped} skipped")

    for name, run, ok, bad, skip in rows:
        print(f"  {name}: {run} run, {ok} passed, {bad} failed, {skip} skipped")
    line = f"{label}: {total} run, {passed} passed, {failed} failed, {skipped} skipped"
    print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"### {label}\n\n| Report | Run | Passed | Failed | Skipped |\n|---|---:|---:|---:|---:|\n")
            # Many reports (one Surefire file per class) collapse to the total.
            if len(rows) <= 5:
                for row in rows:
                    out.write("| " + " | ".join(str(value) for value in row) + " |\n")
            out.write(f"| **Total ({len(rows)} reports)** | {total} | {passed} | {failed} | {skipped} |\n\n")
            for problem in problems:
                out.write(f"- **{problem}**\n")
    for problem in problems:
        print(f"::error::{label}: {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
