#!/usr/bin/env python3
"""Checks an xcresult summary and records it for people and CI.

Reads `xcrun xcresulttool get test-results summary` JSON on stdin. Prints the
counts, writes <results-dir>/<recipe>-summary.json (counts, toolchain,
simulator) and, under GitHub Actions, appends a Markdown table to
$GITHUB_STEP_SUMMARY. Exits non-zero on a failure, a skipped test, no test, or
a passing count different from the expected one.

usage: summarize-results.py RECIPE [EXPECTED_PASSED]
Environment: RESULTS_DIR, DESTINATION, XCODE, SDK (set by ios-test.sh).
"""

import json
import os
import re
import sys


def main():
    recipe = sys.argv[1]
    if not re.fullmatch(r"[a-z]+", recipe):
        sys.exit("error: invalid recipe name")
    expected = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None
    env = os.environ
    summary = json.load(sys.stdin)

    total, passed = summary["totalTestCount"], summary["passedTests"]
    failed, skipped = summary["failedTests"], summary["skippedTests"]
    devices = [entry["device"] for entry in summary.get("devicesAndConfigurations", [])]
    simulator = ", ".join(
        "{} iOS {} ({})".format(d.get("deviceName"), d.get("osVersion"), d.get("osBuildNumber"))
        for d in devices)
    print(f"tests: {total} total, {passed} passed, {failed} failed, {skipped} skipped")

    problems = []
    if summary["result"] != "Passed" or failed:
        problems.append("failures")
    if skipped:
        problems.append("skipped tests are not accepted")
    if total == 0:
        problems.append("no test ran")
    if expected is not None and passed != expected:
        problems.append(f"expected {expected} passing tests")

    duration = None
    if summary.get("finishTime") and summary.get("startTime"):
        duration = round(summary["finishTime"] - summary["startTime"])
    record = {
        "recipe": recipe,
        "result": "failed" if problems else "passed",
        "problems": problems,
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "xcode": env.get("XCODE", ""),
        "iosSimulatorSdk": env.get("SDK", ""),
        "destination": env.get("DESTINATION", ""),
        "simulator": simulator,
        "durationSeconds": duration,
    }
    # The recipe name is validated above, so the file stays in the results directory.
    results_dir = env.get("RESULTS_DIR", "build/results")
    with open(os.path.join(results_dir, f"{recipe}-summary.json"), "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
        handle.write("\n")

    step_summary = env.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as handle:
            handle.write(f"### iOS {recipe}: {record['result']}\n\n")
            handle.write("| Total | Passed | Failed | Skipped | Duration (s) | Xcode | Simulator SDK | Simulator |\n")
            handle.write("|---:|---:|---:|---:|---:|---|---|---|\n")
            handle.write(f"| {total} | {passed} | {failed} | {skipped} | {duration} | "
                         f"{record['xcode']} | {record['iosSimulatorSdk']} | {simulator} |\n\n")
            if problems:
                handle.write("Problems: " + "; ".join(problems) + "\n\n")

    if problems:
        sys.exit("error: " + "; ".join(problems))


if __name__ == "__main__":
    main()
