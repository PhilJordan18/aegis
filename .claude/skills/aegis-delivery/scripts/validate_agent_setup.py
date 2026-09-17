#!/usr/bin/env python3
"""Validate shared Claude Code and Codex project configuration."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.9 and 3.10 on older macOS installations.
    tomllib = None


ROOT = Path(__file__).resolve().parents[4]
ERRORS: list[str] = []
WARNINGS: list[str] = []


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
    match = re.search(rf"(?m)^{re.escape(key)}:\s*(.+?)\s*$", block)
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


def validate_markdown_links() -> None:
    link_pattern = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
    for path in sorted(ROOT.rglob("*.md")):
        if ".git" in path.parts:
            continue
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
