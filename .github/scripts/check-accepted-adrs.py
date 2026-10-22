#!/usr/bin/env python3
"""Fail a pull request that edits or deletes an accepted ADR, compared with its base.

The local pre-commit hook .githooks/check-accepted-adrs can be bypassed, so CI
applies the same rules, loaded from that hook, to BASE_SHA..HEAD_SHA: a file of
docs/adr/ whose base version is ACCEPTED, or an accepted '## ADR-NNN' fiche of
the document 13 register, must come out unchanged. Adding a new ADR or editing
a proposed one stays allowed. Any git failure fails the check.
"""

import importlib.machinery
import importlib.util
import os
import sys

HOOK = ".githooks/check-accepted-adrs"


def load_hook():
    loader = importlib.machinery.SourceFileLoader("check_accepted_adrs", HOOK)
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def main():
    base, head = os.environ.get("BASE_SHA", ""), os.environ.get("HEAD_SHA", "")
    if not base or not head:
        print("::error::BASE_SHA and HEAD_SHA are required.")
        return 1
    hook = load_hook()
    changed = hook.git("diff", "--name-status", "--no-renames", base, head, "--", hook.ADR_DIR, hook.REGISTER)
    if changed is None:
        print(f"::error::cannot diff {base}..{head}.")
        return 1
    violations = []
    for line in changed.splitlines():
        status, path = line.split("\t", 1)
        if status not in ("M", "D", "T"):
            continue
        before = hook.git("show", f"{base}:{path}")
        if before is None:
            print(f"::error::cannot read {path} at {base}.")
            return 1
        if path.startswith(hook.ADR_DIR):
            if hook.ACCEPTED.search(before):
                violations.append(f"{path} (accepted ADR)")
        elif path == hook.REGISTER:
            after = hook.fiches(hook.git("show", f"{head}:{path}") or "")
            for name, text in hook.fiches(before).items():
                if hook.ACCEPTED.search(text) and after.get(name) != text:
                    violations.append(f"{path}, fiche {name} (accepted)")
    if violations:
        for violation in violations:
            print(f"::error::Accepted ADRs are immutable; edited or removed: {violation}")
        print("Write a new ADR that supersedes it, then update the document 13 register (CONTRIBUTING.md).")
        return 1
    print(f"No accepted ADR changed between {base[:7]} and {head[:7]}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
