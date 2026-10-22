#!/usr/bin/env python3
"""Print the test counts of the iOS result bundles as Markdown (log and GitHub step summary).

Reads every apps/ios/build/results/*.xcresult of this checkout; it takes no argument.
Reporting only: apps/ios/scripts/ios-test.sh already fails the job when a test
fails, is skipped, or none ran.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

RESULTS = Path(__file__).resolve().parents[2] / "apps" / "ios" / "build" / "results"


def summary(bundle):
    output = subprocess.run(
        ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(bundle), "--compact"],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(output)


def main():
    bundles = sorted(path for path in RESULTS.glob("*.xcresult") if path.is_dir())
    if not bundles:
        print(f"::warning::no .xcresult bundle in {RESULTS}")
        return 1
    lines = ["| Bundle | Result | Total | Passed | Failed | Skipped |", "|---|---|---:|---:|---:|---:|"]
    status = 0
    for bundle in bundles:
        try:
            s = summary(bundle)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
            print(f"::warning::cannot read {bundle.name}: {error}")
            status = 1
            continue
        row = [bundle.name, s.get("result"), s.get("totalTestCount"), s.get("passedTests"),
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
    sys.exit(main())
