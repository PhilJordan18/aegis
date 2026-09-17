# Aegis - Claude Code Adapter

@AGENTS.md

`AGENTS.md` is the shared source of project instructions for Claude Code and
Codex. This file contains only Claude Code-specific routing.

## Skills

Project skills live in `.claude/skills/`. Invoke only the skills relevant to the
current task; do not load every skill preemptively.

All Aegis implementation and review roles use `aegis-core`. Add:

- `aegis-contracts` when a REST, MQTT, database, state, or component boundary changes;
- `aegis-delivery` for implementation, planning, ADR, verification, or handoff work;
- the platform skill matching the files being changed;
- `aegis-quality-gate` for independent review.

## Agent routing

Use:

- `solution-architect` for architecture, contracts, ADRs, and cross-component planning;
- `ui-ux-designer` before substantial UI implementation;
- `backend-security-engineer` for Spring Boot and application security;
- `database-engineer` for PostgreSQL, Flyway, concurrency, and query performance;
- `web-engineer` for the React administration application;
- `ios-engineer` for SwiftUI technician workflows;
- `firmware-engineer` for ESP32, sensors, locks, and MQTT device behavior;
- `qa-reliability-engineer` as an independent read-only quality gate;
- `diagram-engineer` for architecture, wiring, sequence, state, or ER diagrams.

Do not invoke all agents for every task. The main Claude session is the
orchestrator; create a specialist only when isolation, independent review, or
parallel work provides a concrete benefit.

## Agent Team protocol

Agent Teams coordinate Claude sessions; they do not replace Git, pull requests,
or communication between Philippe and Jimmy.

Use Agent Teams only for independent deliverables. Default to two or three
teammates. Before parallel implementation, the lead must assign file ownership,
task dependencies, shared contracts, and one owner per Flyway migration.

When running as a teammate:

- invoke every skill listed in the role's `Required skills` section;
- announce file ownership before editing;
- do not edit a file owned by another teammate;
- send blockers, contract changes, and migration concerns to the relevant owner;
- return verification evidence, limitations, and a concise handoff;
- do not create nested teammates unless the human explicitly requests it.
