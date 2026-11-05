#!/usr/bin/env python3
"""Aggregate the CI jobs into the single required `CI result` check.

Usage: ci-result.py <changes-result> <label>=<needed>:<result> [...]

<changes-result> is needs.changes.result. Each job is given as its label, the
change-detection output that says whether it had to run ("true" or "false"),
and needs.<job>.result. The check fails, never passes by default, when:

- change detection did not succeed;
- a needed flag is anything but "true" or "false" (a missing output must not
  read as "not needed");
- a needed job did not end as "success" (failure, cancelled, skipped or a
  missing result);
- a job that was not needed ended as anything but "skipped" or "success".

Writes one line per job to the log and, on GitHub, a table to the step summary.
"""

import os
import sys

NEEDED = {"true", "false"}


def verdict(needed, result):
    """Return None when the job is acceptable, else the reason it is not."""
    if needed not in NEEDED:
        return f"its change-detection output is {needed or 'missing'!r}"
    if needed == "true" and result != "success":
        return f"it was required and ended as {result or 'missing'!r}"
    if needed == "false" and result not in ("skipped", "success"):
        return f"it was not required but ended as {result or 'missing'!r}"
    return None


def parse(argument):
    label, separator, rest = argument.partition("=")
    needed, colon, result = rest.partition(":")
    if not label or not separator or not colon:
        raise ValueError(f"malformed job argument {argument!r}")
    return label, needed, result


def main(argv):
    if len(argv) < 3:
        print("usage: ci-result.py <changes-result> <label>=<needed>:<result> [...]", file=sys.stderr)
        return 2
    changes = argv[1]
    try:
        jobs = [parse(argument) for argument in argv[2:]]
    except ValueError as error:
        print(f"::error::{error}")
        return 2

    errors = []
    if changes != "success":
        errors.append(f"Change detection did not succeed ({changes or 'missing'}).")
    rows = []
    for label, needed, result in jobs:
        reason = verdict(needed, result)
        rows.append((label, needed or "missing", result or "missing", "ok" if reason is None else "blocking"))
        print(f"{label}: needed={needed or 'missing'} result={result or 'missing'}")
        if reason is not None:
            errors.append(f"{label}: {reason}.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"### CI result: {'failed' if errors else 'passed'}\n\n")
            out.write(f"Change detection: {changes or 'missing'}\n\n")
            out.write("| Job | Needed | Result | Verdict |\n|---|---|---|---|\n")
            for row in rows:
                out.write("| " + " | ".join(row) + " |\n")
            out.write("\n")
    for message in errors:
        print(f"::error::{message}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
