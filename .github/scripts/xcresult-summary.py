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


def load_summary(results=RESULTS):
    """One line on the simulator load samples (#67), or None without samples.

    Reporting only: the samples never change the job's outcome.
    """
    boot, samples = results / "simulator-boot.txt", results / "simulator-load.tsv"
    if not samples.is_file():
        return None
    rows = []
    for line in samples.read_text(encoding="utf-8").splitlines()[1:]:
        fields = line.split("\t")
        try:
            rows.append((int(fields[0]), float(fields[1]), int(fields[2])))
        except (IndexError, ValueError):
            continue
    if not rows:
        return "Simulator load: no readable sample"
    ready = None
    if boot.is_file():
        for line in boot.read_text(encoding="utf-8").splitlines():
            if line.startswith("ready_epoch="):
                ready = int(line.split("=", 1)[1])
    first = rows[0][0] if ready is None else ready
    peak = max(rows, key=lambda row: row[1])
    return (f"Simulator load: {len(rows)} samples over {rows[-1][0] - rows[0][0]} s; "
            f"load1 {rows[0][1]:.2f} at the first sample, peak {peak[1]:.2f} at +{peak[0] - first} s "
            f"after ready, {rows[-1][1]:.2f} at the last; simulator processes "
            f"{rows[0][2]} to {max(row[2] for row in rows)}")


def main():
    load = load_summary()
    if load:
        print(load)
        path = os.environ.get("GITHUB_STEP_SUMMARY")
        if path:
            with open(path, "a", encoding="utf-8") as out:
                out.write(load + "\n\n")
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
            out.write("### iOS tests\n\n" + text)
    return status


if __name__ == "__main__":
    sys.exit(main())
