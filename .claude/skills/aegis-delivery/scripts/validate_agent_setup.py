#!/usr/bin/env python3
"""Validate shared Claude Code and Codex project configuration."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.9 and 3.10 on older macOS installations.
    tomllib = None


ROOT = Path(__file__).resolve().parents[4]
# Used only when Git cannot list the files; dependency READMEs are not ours to fix.
IGNORED_DIRECTORIES = {".git", "node_modules", "dist", "dist-preview", "target", "test-results"}
ERRORS: list[str] = []
WARNINGS: list[str] = []

# Human-approved model policy (issue #65). Full IDs avoid alias drift; Sonnet 5.5
# requires Claude Code 2.1.284 or later. Change only with a human decision.
AGENT_POLICY = {
    "solution-architect": ("claude-opus-5-5", "xhigh"),
    "database-engineer": ("claude-opus-5-5", "xhigh"),
    "backend-security-engineer": ("claude-opus-5-5", "high"),
    "ios-engineer": ("claude-opus-5-5", "high"),
    "firmware-engineer": ("claude-opus-5-5", "high"),
    "qa-reliability-engineer": ("claude-opus-5-5", "high"),
    "web-engineer": ("claude-sonnet-5-5", "high"),
    "ui-ux-designer": ("claude-sonnet-5-5", "high"),
    "diagram-engineer": ("claude-sonnet-5-5", "medium"),
    "security-deep-reviewer": ("claude-fable-5-1", "high"),
}
# Chosen per session in the app; agent_runtime_report.py compares it with the transcript.
MAIN_SESSION_POLICY = ("claude-opus-5-5", "high")
# Fable bills extra usage: these roles run only after an explicit human request.
OPT_IN_AGENTS = {"security-deep-reviewer"}
READ_ONLY_AGENTS = {"qa-reliability-engineer", "security-deep-reviewer"}
# Skills each role must keep preloading (lists as of issue #65); a role may add more.
REQUIRED_SKILLS = {
    "solution-architect": {"aegis-core", "aegis-contracts", "aegis-delivery"},
    "database-engineer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-postgres"},
    "backend-security-engineer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-spring-security"},
    "ios-engineer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-product-design", "aegis-swiftui"},
    "firmware-engineer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-esp32-mqtt"},
    "qa-reliability-engineer": {"aegis-core", "aegis-contracts", "aegis-product-design", "aegis-quality-gate"},
    "web-engineer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-product-design", "aegis-react-admin"},
    "ui-ux-designer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-product-design"},
    "diagram-engineer": {"aegis-core", "aegis-contracts", "aegis-delivery", "aegis-hardware-diagrams"},
    "security-deep-reviewer": {"aegis-core", "aegis-contracts", "aegis-quality-gate"},
}
# Desktop tools that can switch a session's model or effort outside the launch gate.
SESSION_RUNTIME_TOOLS = (
    "mcp__ccd_session_mgmt__set_session_model",
    "mcp__ccd_session_mgmt__set_session_effort",
)
EDITING_TOOLS = {"Edit", "Write", "NotebookEdit", "Agent", "Task"}
# `max` stays a deliberate per-session choice, never a stored default.
ALLOWED_EFFORTS = {"low", "medium", "high", "xhigh"}
GATE_HOOK = ".claude/hooks/gate_agent_launch.py"
CLAUDE_MODEL_ID = re.compile(r"claude-(?:opus|sonnet|haiku|fable)-[0-9]")
# Oldest Claude Code release that recognizes every pinned model (Sonnet 5.5).
MINIMUM_RUNTIME = (2, 1, 284)


def error(message: str) -> None:
    ERRORS.append(message)


def warning(message: str) -> None:
    WARNINGS.append(message)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        error(f"Cannot read {path.relative_to(ROOT)}: {exc}")
        return ""


def frontmatter(text: str, path: Path) -> str:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        error(f"Missing YAML frontmatter: {path.relative_to(ROOT)}")
        return ""
    return match.group(1)


def frontmatter_value(block: str, key: str) -> str | None:
    match = re.search(rf"(?m)^{re.escape(key)}:[ \t]*(.+?)[ \t]*$", block)
    return match.group(1).strip('"\'') if match else None


def validate_required_files() -> None:
    for relative in (
        "AGENTS.md",
        "CLAUDE.md",
        ".claude/settings.json",
        ".codex/config.toml",
    ):
        if not (ROOT / relative).is_file():
            error(f"Missing required file: {relative}")


def validate_structured_configuration() -> None:
    settings = ROOT / ".claude/settings.json"
    if settings.is_file():
        try:
            json.loads(read_text(settings))
        except json.JSONDecodeError as exc:
            error(f"Invalid JSON in {settings.relative_to(ROOT)}: {exc}")

    toml_paths = sorted((ROOT / ".codex").rglob("*.toml"))
    if tomllib is None:
        warning("Full TOML parsing skipped because Python is older than 3.11")
        for path in toml_paths:
            text = read_text(path)
            if path.parent.name == "agents":
                for key in ("name", "description", "developer_instructions"):
                    if not re.search(rf"(?m)^{key}\s*=", text):
                        error(f"Missing {key!r} in {path.relative_to(ROOT)}")
            if text.count('"""') % 2:
                error(f"Unbalanced multiline string in {path.relative_to(ROOT)}")
    else:
        for path in toml_paths:
            try:
                tomllib.loads(read_text(path))
            except tomllib.TOMLDecodeError as exc:
                error(f"Invalid TOML in {path.relative_to(ROOT)}: {exc}")


def validate_skills() -> None:
    skills_root = ROOT / ".claude/skills"
    known: set[str] = set()

    for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.is_file():
            error(f"Missing SKILL.md: {skill_dir.relative_to(ROOT)}")
            continue

        block = frontmatter(read_text(skill_file), skill_file)
        name = frontmatter_value(block, "name")
        description = frontmatter_value(block, "description")
        if name != skill_dir.name:
            error(
                f"Skill folder/name mismatch: {skill_dir.name!r} contains name {name!r}"
            )
        if not description:
            error(f"Skill has no description: {skill_file.relative_to(ROOT)}")
        if name in known:
            error(f"Duplicate skill name: {name}")
        if name:
            known.add(name)

        codex_link = ROOT / ".agents/skills" / skill_dir.name
        if not codex_link.exists():
            error(f"Codex skill exposure is missing: {codex_link.relative_to(ROOT)}")
        elif codex_link.resolve() != skill_dir.resolve():
            error(f"Codex skill link points to the wrong target: {codex_link.relative_to(ROOT)}")

    for agent_file in sorted((ROOT / ".claude/agents").glob("*.md")):
        block = frontmatter(read_text(agent_file), agent_file)
        skills_match = re.search(r"(?ms)^skills:\s*\n((?:\s+-\s+[^\n]+\n?)+)", block)
        if not skills_match:
            continue
        for skill in re.findall(r"(?m)^\s+-\s+([a-z0-9-]+)\s*$", skills_match.group(1)):
            if skill not in known:
                error(f"{agent_file.relative_to(ROOT)} references unknown skill {skill!r}")


def required_skills_section(text: str) -> str:
    match = re.search(r"(?ms)^## Required skills\s*\n(.*?)(?=^## |\Z)", text)
    return match.group(1) if match else ""


def validate_agent_runtime_policy() -> None:
    """Check pinned models, efforts, tool limits and skill lists against the policy."""
    seen: set[str] = set()
    for agent_file in sorted((ROOT / ".claude/agents").glob("*.md")):
        relative = agent_file.relative_to(ROOT)
        text = read_text(agent_file)
        block = frontmatter(text, agent_file)
        name = frontmatter_value(block, "name")
        model = frontmatter_value(block, "model")
        effort = frontmatter_value(block, "effort")
        if name != agent_file.stem:
            error(f"Agent file/name mismatch: {relative} contains name {name!r}")
        seen.add(agent_file.stem)

        if agent_file.stem not in AGENT_POLICY:
            error(f"{relative} has no entry in AGENT_POLICY; add one only with a human decision")
        else:
            expected_model, expected_effort = AGENT_POLICY[agent_file.stem]
            if model != expected_model:
                error(f"{relative} uses model {model!r}; policy requires {expected_model!r}")
            if effort != expected_effort:
                error(f"{relative} uses effort {effort!r}; policy requires {expected_effort!r}")
        if effort not in ALLOWED_EFFORTS:
            error(f"{relative} uses effort {effort!r}; stored efforts must be one of {sorted(ALLOWED_EFFORTS)}")

        tools = {tool.strip(" []'\"") for tool in (frontmatter_value(block, "tools") or "").split(",")
                 if tool.strip(" []'\"")}
        if agent_file.stem in READ_ONLY_AGENTS:
            if not tools:
                error(f"{relative} is a reviewer and must declare a tools allowlist")
            elif tools & EDITING_TOOLS:
                error(f"{relative} is a reviewer but allows {sorted(tools & EDITING_TOOLS)}")

        if model and "fable" in model and agent_file.stem not in OPT_IN_AGENTS:
            error(f"{relative} runs on Fable but is not declared opt-in")
        if agent_file.stem in OPT_IN_AGENTS and not (frontmatter_value(block, "description") or "").startswith("Opt-in only"):
            error(f"{relative} is opt-in; its description must start with 'Opt-in only'")

        if re.search(r"(?m)^skills:[ \t]*\S", block):
            error(f"{relative} declares skills inline; use one '- skill' line per skill")
        if re.search(r"(?m)^tools:[ \t]*(?:\[|$)", block):
            error(f"{relative} declares tools as a list; use one comma-separated line")
        skills_match = re.search(r"(?ms)^skills:\s*\n((?:\s+-\s+[^\n]+\n?)+)", block)
        declared = re.findall(r"(?m)^\s+-\s+([a-z0-9-]+)\s*$", skills_match.group(1)) if skills_match else []
        for skill in sorted(REQUIRED_SKILLS.get(agent_file.stem, set()) - set(declared)):
            error(f"{relative} no longer preloads required skill {skill!r}")
        section = required_skills_section(text)
        if declared and not section:
            error(f"{relative} preloads skills but has no '## Required skills' section for teammates")
        for skill in declared:
            if section and f"`{skill}`" not in section:
                error(f"{relative} preloads {skill!r} but its Required skills section omits it")

    for missing in sorted(set(AGENT_POLICY) - seen):
        error(f"AGENT_POLICY names {missing!r} but .claude/agents/{missing}.md is missing")


def validate_launch_gate() -> None:
    """Prove the PreToolUse gate is registered and asks before every opt-in launch."""
    hook = ROOT / GATE_HOOK
    if not hook.is_file():
        error(f"Missing agent launch gate: {GATE_HOOK}")
        return
    try:
        settings = json.loads(read_text(ROOT / ".claude/settings.json") or "{}")
    except json.JSONDecodeError:
        return
    entries = settings.get("hooks", {}).get("PreToolUse", [])
    registered = [
        entry for entry in entries
        if {"Agent", "Workflow"} <= set(str(entry.get("matcher", "")).split("|"))
        and any(GATE_HOOK in str(item.get("command", "")) for item in entry.get("hooks", []))
    ]
    commands = [str(item.get("command", "")) for entry in registered for item in entry.get("hooks", [])
                if GATE_HOOK in str(item.get("command", ""))]
    if not commands:
        error(f".claude/settings.json must run {GATE_HOOK} on PreToolUse for Agent and Workflow")
        return
    asked = settings.get("permissions", {}).get("ask", [])
    for tool in SESSION_RUNTIME_TOOLS:
        if tool not in asked:
            error(f".claude/settings.json must list {tool} in permissions.ask")

    def decision(event: dict) -> str | None:
        """Run the registered command, not just the script, as Claude Code would."""
        try:
            result = subprocess.run(
                ["/bin/sh", "-c", commands[0]], input=json.dumps(event), capture_output=True, text=True,
                env={"CLAUDE_PROJECT_DIR": str(ROOT), "HOME": str(Path.home()),
                     "PATH": os.environ.get("PATH", "/usr/bin:/bin")},
                timeout=20,
            )
            output = result.stdout.strip()
            return json.loads(output)["hookSpecificOutput"]["permissionDecision"] if output else None
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as exc:
            error(f"Launch gate command failed on a synthetic event: {exc.__class__.__name__}")
            return "failed"

    must_ask = {}
    for name in sorted(OPT_IN_AGENTS):
        must_ask.update({
            f"an Agent launch of {name!r}": {"tool_name": "Agent", "tool_input": {"subagent_type": name}},
            f"a workflow naming {name!r}": {
                "tool_name": "Workflow", "tool_input": {"script": f"agent('x', {{agentType: '{name}'}})"}},
            f"a workflow naming {name!r} with a quoted key": {
                "tool_name": "Workflow", "tool_input": {"script": f"agent('x', {{'agentType': '{name}'}})"}},
            f"a workflow spreading {name!r} from args": {"tool_name": "Workflow", "tool_input": {
                "script": "agent('x', {...args.opts})", "args": {"opts": {"agentType": name}}}},
        })
    must_ask.update({
        "a per-call Fable model override": {
            "tool_name": "Agent", "tool_input": {"subagent_type": "general-purpose", "model": "fable"}},
        "a Fable launch after a regex literal with a backtick": {"tool_name": "Workflow", "tool_input": {
            "script": "const strip = (s) => s.split(/```/)[1] ?? s;\n"
                      "await agent('Review the diff', {agentType: 'security-deep-reviewer'});\n"
                      "log(`done: ${strip(r)}`);"}},
        "a Fable value inside a JSON string": {"tool_name": "Workflow", "tool_input": {
            "script": "agent('x', JSON.parse('{\"model\": \"fable\"}'))"}},
        "a Fable value inside an escaped JSON string": {"tool_name": "Workflow", "tool_input": {
            "script": "agent('x', JSON.parse(\"{\\\"model\\\": \\\"fable\\\"}\"))"}},
        "a workflow computing agentType": {
            "tool_name": "Workflow", "tool_input": {"script": "agent('x', {agentType: pick()})"}},
        "a workflow computing agentType from an array": {
            "tool_name": "Workflow", "tool_input": {"script": "agent('x', {agentType: [role][0]})"}},
        "a workflow passing agentType by shorthand": {
            "tool_name": "Workflow", "tool_input": {"script": "agent('x', {agentType})"}},
        "a nested workflow it cannot inspect": {
            "tool_name": "Workflow", "tool_input": {"script": "await workflow('other')"}},
        "a named workflow it cannot inspect": {
            "tool_name": "Workflow", "tool_input": {"name": "unknown-saved-workflow"}},
    })
    must_allow = {
        "a routine ios-engineer launch": {"tool_name": "Agent", "tool_input": {"subagent_type": "ios-engineer"}},
        "a routine workflow that mentions Fable in prose": {"tool_name": "Workflow", "tool_input": {
            "script": "// never launch Fable\nagent('Report your model: and any nested workflow() call', "
                      "{agentType: 'qa-reliability-engineer'})"}},
        "a workflow schema with a model property": {"tool_name": "Workflow", "tool_input": {
            "script": "agent('x', {schema: {properties: {model: {type: 'string'}}}})"}},
    }
    for label, event in must_ask.items():
        if decision(event) != "ask":
            error(f"Launch gate does not ask before {label}")
    for label, event in must_allow.items():
        if decision(event) is not None:
            error(f"Launch gate interrupts {label}")


def validate_model_neutral_layers() -> None:
    """Skills and Codex adapters stay model-neutral; shared settings never pin max effort."""
    for skill_file in sorted((ROOT / ".claude/skills").glob("*/SKILL.md")):
        block = frontmatter(read_text(skill_file), skill_file)
        for key in ("model", "effort"):
            if frontmatter_value(block, key) is not None:
                error(f"{skill_file.relative_to(ROOT)} declares {key!r}; skills must not switch model or effort")
        forked_agent = frontmatter_value(block, "agent") or ""
        if forked_agent in OPT_IN_AGENTS or "fable" in forked_agent.lower():
            error(f"{skill_file.relative_to(ROOT)} forks into opt-in agent {forked_agent!r}, bypassing the launch gate")

    for path in sorted((ROOT / ".codex").rglob("*.toml")):
        if CLAUDE_MODEL_ID.search(read_text(path)):
            error(f"{path.relative_to(ROOT)} contains a Claude model ID; Codex adapters stay model-neutral")

    overrides = ("ANTHROPIC_MODEL", "CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CODE_SUBAGENT_MODEL",
                 "CLAUDE_CODE_SUBAGENT_MODEL_FORCE")
    for relative, report in ((".claude/settings.json", error), (".claude/settings.local.json", warning)):
        path = ROOT / relative
        if not path.is_file():
            continue
        try:
            settings = json.loads(read_text(path))
        except json.JSONDecodeError:
            continue
        if re.search(r'"effortLevel":\s*"max"', json.dumps(settings)):
            report(f"{relative} stores max effort; choose max per session only")
        for variable in overrides:
            if variable in settings.get("env", {}):
                report(f"{relative} sets {variable}, which overrides the pinned agent models or efforts")
        if settings.get("disableAllHooks"):
            report(f"{relative} disables hooks, including the agent launch gate")
        if "ultracode" in json.dumps(settings).lower():
            report(f"{relative} enables Ultracode permanently; opt in per request instead")


def validate_runtime_versions() -> None:
    """Warn when the app runtime or the terminal `claude` predates a pinned model."""
    candidates = {os.environ.get("CLAUDE_CODE_EXECPATH"), shutil.which("claude")}
    for executable in sorted(path for path in candidates if path):
        try:
            output = subprocess.run(
                [executable, "--version"], capture_output=True, text=True, timeout=30
            ).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        match = re.search(r"(\d+)\.(\d+)\.(\d+)", output)
        if match and tuple(int(part) for part in match.groups()) < MINIMUM_RUNTIME:
            warning(
                f"Claude Code {match.group(0)} at {executable} predates Sonnet 5.5 "
                f"({'.'.join(map(str, MINIMUM_RUNTIME))}); update it or keep Sonnet roles on Opus explicitly"
            )


def validate_stale_routes() -> None:
    stale = {
        "docs/cahier-conception/scope.md": "docs/cahier-conception/02-scope.md",
        "13-decisions-architecture.md": "13-registre-adrs-proposes.md",
        "14-plan-execution-et-iterations.md": "14-plan-iterations-semaines-4-a-15.md",
        "docs/cahier-conception/communication.md": "documents 07, 09, and 10",
    }
    candidates = [ROOT / "AGENTS.md", ROOT / "CLAUDE.md"]
    candidates.extend((ROOT / ".claude/agents").glob("*.md"))
    candidates.extend((ROOT / ".claude/skills").glob("*/SKILL.md"))
    for path in candidates:
        text = read_text(path)
        for old, replacement in stale.items():
            if old in text:
                error(
                    f"Stale route {old!r} in {path.relative_to(ROOT)}; use {replacement!r}"
                )


def markdown_files() -> list[Path]:
    """Return the Markdown files Git tracks or would track, skipping ignored paths."""
    try:
        listing = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
            cwd=ROOT,
            check=True,
            capture_output=True,
        ).stdout.decode("utf-8")
    except (OSError, subprocess.CalledProcessError, UnicodeError):
        warning("Git could not list files; Markdown links checked with a fixed ignore list")
        return sorted(
            path for path in ROOT.rglob("*.md")
            if not IGNORED_DIRECTORIES.intersection(path.relative_to(ROOT).parts)
        )
    return sorted(path for path in (ROOT / name for name in listing.split("\0") if name) if path.is_file())


def validate_markdown_links() -> None:
    link_pattern = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
    for path in markdown_files():
        for target in link_pattern.findall(read_text(path)):
            clean = target.strip().split("#", 1)[0]
            if not clean or clean.startswith(("http://", "https://", "mailto:")):
                continue
            if clean.startswith("/"):
                continue
            resolved = (path.parent / clean).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                continue
            if not resolved.exists():
                error(f"Broken local link in {path.relative_to(ROOT)}: {target}")


def validate_document_health() -> None:
    index = ROOT / "docs/cahier-conception/01-index.md"
    if index.is_file() and not read_text(index).strip():
        warning("docs/cahier-conception/01-index.md is empty")

    state_machines = ROOT / "docs/cahier-conception/05-machines-a-etats.md"
    mqtt = ROOT / "docs/cahier-conception/10-contrats-mqtt.md"
    if state_machines.is_file() and mqtt.is_file():
        first = hashlib.sha256(state_machines.read_bytes()).digest()
        second = hashlib.sha256(mqtt.read_bytes()).digest()
        if first == second:
            warning(
                "documents 05 and 10 are byte-identical; the state-machine document appears overwritten"
            )


def main() -> int:
    validate_required_files()
    validate_structured_configuration()
    validate_skills()
    validate_agent_runtime_policy()
    validate_launch_gate()
    validate_model_neutral_layers()
    validate_runtime_versions()
    validate_stale_routes()
    validate_markdown_links()
    validate_document_health()

    for message in ERRORS:
        print(f"ERROR: {message}")
    for message in WARNINGS:
        print(f"WARNING: {message}")

    if ERRORS:
        print(f"Agent setup validation failed: {len(ERRORS)} error(s), {len(WARNINGS)} warning(s).")
        return 1
    print(f"Agent setup validation passed with {len(WARNINGS)} warning(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
