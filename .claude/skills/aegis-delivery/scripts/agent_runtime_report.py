#!/usr/bin/env python3
"""Report the model, effort and skills each agent of a Claude Code session actually used.

Reads local transcripts only and prints no message content. The transcript
format is internal to Claude Code (observed on 2.1.295); a missing field is
reported as unknown rather than guessed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_agent_setup import AGENT_POLICY, MAIN_SESSION_POLICY, ROOT  # noqa: E402

PROJECTS = Path.home() / ".claude/projects"
SKILL_BASE = re.compile(r"Base directory for this skill: \S*/skills/([a-z0-9-]+)")


def transcript_dir(checkout: Path) -> Path:
    return PROJECTS / re.sub(r"[^A-Za-z0-9]", "-", str(checkout.resolve()))


def find_session(session: str | None, checkout: Path) -> tuple[Path | None, str]:
    """Prefer the explicit or current session; fall back to the newest one of the checkout."""
    session = session or os.environ.get("CLAUDE_CODE_SESSION_ID")
    if session:
        matches = sorted(PROJECTS.glob(f"*/{session}.jsonl"))
        return (matches[0] if matches else None), f"session {session}"
    sessions = sorted(transcript_dir(checkout).glob("*.jsonl"), key=lambda path: path.stat().st_mtime)
    return (sessions[-1] if sessions else None), f"newest session under {transcript_dir(checkout)}"


def summarize(path: Path) -> dict:
    requested: Counter = Counter()
    observed: Counter = Counter()
    efforts: Counter = Counter()
    versions: set[str] = set()
    preloaded: list[str] = []
    invoked: list[str] = []
    answered = False
    for line in path.open(encoding="utf-8", errors="ignore"):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict):
            continue
        message = entry.get("message") or {}
        content = message.get("content")
        parts = content if isinstance(content, list) else [{"type": "text", "text": content or ""}]
        if entry.get("type") == "assistant":
            answered = True
            if message.get("model") == "<synthetic>":
                continue  # interrupts and API errors, not a model run
            requested[entry.get("requestedModel") or "unknown"] += 1
            observed[message.get("model") or "unknown"] += 1
            efforts[entry.get("effort") or "unknown"] += 1
            versions.add(entry.get("version") or "unknown")
            for part in parts:
                if part.get("type") == "tool_use" and part.get("name") == "Skill":
                    invoked.append(str((part.get("input") or {}).get("skill")))
        elif entry.get("type") == "user" and entry.get("isMeta") and not answered:
            for part in parts:
                preloaded.extend(SKILL_BASE.findall(str(part.get("text") or "")))
    return {"requested": requested, "observed": observed, "efforts": efforts, "versions": versions,
            "preloaded": list(dict.fromkeys(preloaded)), "invoked": list(dict.fromkeys(invoked))}


def flags(role: str, summary: dict, policy: tuple[str, str] | None) -> list[str]:
    found = []
    requested = set(summary["requested"]) - {"unknown"}
    observed = set(summary["observed"]) - {"unknown"}
    efforts = set(summary["efforts"]) - {"unknown"}
    if "unknown" in summary["requested"]:
        found.append(f"{role}: requested model not recorded on some turns (older runtime); substitution not checked there")
    if requested and observed - requested:
        found.append(f"{role}: ran on {sorted(observed - requested)} although {sorted(requested)} was requested")
    if policy:
        model, effort = policy
        if requested - {model}:
            found.append(f"{role}: requested {sorted(requested)}; policy is {model}")
        if efforts - {effort}:
            found.append(f"{role}: effort {sorted(efforts)}; policy is {effort}")
        if "unknown" in summary["efforts"]:
            found.append(f"{role}: effort not recorded on some turns")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", help="session ID; default is $CLAUDE_CODE_SESSION_ID, else the newest session of the checkout")
    parser.add_argument("--checkout", type=Path, default=ROOT, help="checkout whose sessions to read")
    args = parser.parse_args()

    main_path, chosen = find_session(args.session, args.checkout)
    if not main_path:
        print(f"No transcript found for {chosen}")
        return 1

    rows = [("main session", main_path, MAIN_SESSION_POLICY)]
    for agent_path in sorted(main_path.with_suffix("").glob("subagents/**/agent-*.jsonl")):
        meta_path = agent_path.with_name(agent_path.stem + ".meta.json")
        try:
            meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
        except (OSError, json.JSONDecodeError):
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        agent_type = meta.get("agentType") or "unknown"
        rows.append((f"{agent_type} ({agent_path.stem[6:14]})", agent_path, AGENT_POLICY.get(agent_type)))

    print(f"Session {main_path.stem} (chosen from {chosen})")
    findings = []
    for role, path, policy in rows:
        summary = summarize(path)
        expected = f"{policy[0]}/{policy[1]}" if policy else "no project policy"
        print(f"\n{role}")
        print(f"  policy:     {expected}")
        print(f"  requested:  {dict(summary['requested'])}")
        print(f"  observed:   {dict(summary['observed'])}")
        print(f"  effort:     {dict(summary['efforts'])}")
        print(f"  runtime:    {sorted(summary['versions'])}")
        print(f"  preloaded:  {summary['preloaded'] or 'none'}")
        print(f"  invoked:    {summary['invoked'] or 'none'}")
        findings.extend(flags(role, summary, policy))

    print("\nDifferences between policy, request and observation:")
    print("\n".join(f"- {finding}" for finding in findings) if findings else "- none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
