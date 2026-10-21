#!/usr/bin/env python3
"""PreToolUse gate: ask the human before an agent launch bills Fable or bypasses a pinned model.

A permissions "ask" rule written as Agent(<name>) did not stop a subagent launch
in Claude Code 2.1.295, so the opt-in rule for Fable roles is enforced here.
Printing nothing lets the launch continue under the normal permission rules.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])
AGENTS = ROOT / ".claude/agents"
WORKFLOW_DIRS = (ROOT / ".claude/workflows", Path.home() / ".claude/workflows")
FABLE = re.compile(r"fable", re.IGNORECASE)
SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")
# Workflow agent() options that choose who runs and on which model.
LAUNCH_KEY = re.compile(r"""['"]?\b(agentType|model)\b['"]?\s*:""")
SHORTHAND_KEY = re.compile(r"[{,]\s*(agentType|model)\s*(?=[,}])")
LITERAL = re.compile(r"""\s*(['"])([^'"\\\n]*)\1\s*(?=[,}\)\n])""")
NESTED_WORKFLOW = re.compile(r"\bworkflow\s*\(")
# Comments and string literals, scanned left to right so each wins where it starts.
COMMENT_OR_STRING = re.compile(
    r"""//[^\n]*|/\*.*?\*/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`""", re.DOTALL)
# A quoted bare token (no spaces) can be an agentType or model value; prose cannot.
QUOTED_TOKEN = re.compile(r"""(['"`])([A-Za-z0-9._:\[\]-]+)\\?\1""")


def definition(name: str) -> dict[str, str] | None:
    if not SAFE_NAME.match(name):
        return None
    path = AGENTS / f"{name}.md"
    if not path.is_file():
        return None
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", path.read_text(encoding="utf-8"), re.DOTALL)
    if not match:
        return None
    return dict(re.findall(r"(?m)^(model|effort):[ \t]*(\S+)[ \t]*$", match.group(1)))


def fable_agents() -> set[str]:
    return {path.stem for path in AGENTS.glob("*.md")
            if FABLE.search((definition(path.stem) or {}).get("model", ""))}


def bills_fable(value: str) -> bool:
    return bool(FABLE.search(value)) or value in fable_agents()


def agent_reason(data: dict) -> str | None:
    name = str(data.get("subagent_type") or "")
    pinned = definition(name)
    requested = str(data.get("model") or "")
    if bills_fable(requested) or bills_fable(name) or (pinned and bills_fable(pinned.get("model", ""))):
        return (f"'{name or 'agent'}' would run on Fable, which bills extra usage. Approve only if "
                "you explicitly asked for this launch in this request and accept the cost.")
    if pinned:
        overrides = [f"{key} {data[key]!r} instead of {pinned.get(key)!r}"
                     for key in ("model", "effort") if data.get(key) and data[key] != pinned.get(key)]
        if overrides:
            return (f"'{name}' launch overrides its pinned configuration ({'; '.join(overrides)}). "
                    "Approve only if you asked for this substitution.")
    return None


def workflow_source(data: dict) -> tuple[str, str | None]:
    """Return the script text to inspect, or a reason when it cannot be read."""
    text = str(data.get("script") or "")
    script_path = data.get("scriptPath")
    if script_path:
        path = Path(script_path)
        if not path.is_file():
            return text, f"workflow script {script_path!r} could not be read"
        text += "\n" + path.read_text(encoding="utf-8", errors="ignore")
    name = data.get("name")
    if name:
        found = [path for folder in WORKFLOW_DIRS for path in sorted(folder.glob(f"{name}.*"))
                 if SAFE_NAME.match(str(name))]
        if not found:
            return text, f"named workflow {name!r} could not be inspected"
        text += "\n" + found[0].read_text(encoding="utf-8", errors="ignore")
    return text, None


def code_only(text: str) -> str:
    """Drop comments and prose strings so that prompts cannot trigger or hide a launch option.

    Token-like strings (no whitespace) stay, because they can be agentType or model values.
    """
    def keep(match: re.Match) -> str:
        token = match.group(0)
        if token.startswith("/"):
            return " "
        return token if not re.search(r"\s", token[1:-1]) else token[0] + "_" + token[-1]
    return COMMENT_OR_STRING.sub(keep, text)


def workflow_reason(data: dict) -> str | None:
    raw, unreadable = workflow_source(data)
    # Checked on the raw text: the blanking below does not parse regex literals,
    # so an odd quote or backtick in one could otherwise hide a literal Fable value.
    for _, value in QUOTED_TOKEN.findall(raw + "\n" + json.dumps(data.get("args"))):
        if bills_fable(value):
            return (f"Workflow names Fable or a Fable-only role ({value!r}), which bills extra usage. "
                    "Approve only if you explicitly asked for it and accept the cost.")
    text = code_only(raw)
    if unreadable:
        return f"Agent launch gate: {unreadable}; it may launch a Fable role. Approve only if you know it does not, or accept the cost."
    if NESTED_WORKFLOW.search(text):
        return "This workflow runs a nested workflow that the gate cannot inspect. Approve only if it launches no Fable role, or you accept the cost."

    shorthand = SHORTHAND_KEY.search(text)
    if shorthand:
        return (f"Workflow passes {shorthand.group(1)!r} from a variable; the gate cannot rule out Fable. "
                "Approve only if you asked for this run and accept any Fable cost.")
    for match in LAUNCH_KEY.finditer(text):
        if match.group(1) == "model" and text[match.end():].lstrip()[:1] in ("{", "["):
            continue  # a JSON-schema property named model, not a launch option
        literal = LITERAL.match(text, match.end())
        snippet = text[match.start():match.end() + 40].split("\n")[0]
        if not literal:
            return (f"Workflow chooses an agent or model dynamically ({snippet!r}); the gate cannot rule out "
                    "Fable. Approve only if you asked for this run and accept any Fable cost.")
        if bills_fable(literal.group(2)):
            return (f"Workflow launches Fable ({snippet!r}), which bills extra usage. Approve only if you "
                    "explicitly asked for it and accept the cost.")
    return None


def reason_for(event: dict) -> str | None:
    tool = event.get("tool_name")
    data = event.get("tool_input") or {}
    if tool in ("Agent", "Task"):
        return agent_reason(data)
    if tool == "Workflow":
        return workflow_reason(data)
    return None


def main() -> int:
    try:
        reason = reason_for(json.load(sys.stdin))
    except Exception as exc:  # Fail closed: an unreadable launch must be confirmed by a human.
        reason = f"Agent launch gate could not evaluate this call ({exc.__class__.__name__}); confirm it manually."
    if reason:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
