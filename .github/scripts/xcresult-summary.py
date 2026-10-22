#!/usr/bin/env python3
"""Print the test counts of xcresult bundles as Markdown (log and GitHub step summary).

Usage: xcresult-summary.py <bundle.xcresult> [...]. Reporting only: scripts/ios-test.sh
already fails the job when a test fails, is skipped, or none ran.
"""

import json
import os
import subprocess
import sys


def summary(bundle):
    output = subprocess.run(
        ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", bundle, "--compact"],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(output)


def main(bundles):
    lines = ["| Bundle | Result | Total | Passed | Failed | Skipped |", "|---|---|---:|---:|---:|---:|"]
    status = 0
    for bundle in bundles:
        try:
            s = summary(bundle)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
            print(f"::warning::cannot read {bundle}: {error}")
            status = 1
            continue
        row = [os.path.basename(bundle), s.get("result"), s.get("totalTestCount"), s.get("passedTests"),
               s.get("failedTests"), s.get("skippedTests")]
        lines.append("| " + " | ".join(str(value) for value in row) + " |")
    text = "\n".join(lines) + "\n"
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as out:
            out.write("### iOS standalone tests\n\n" + text)
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
