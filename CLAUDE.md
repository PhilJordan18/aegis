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
- `qa-reliability-engineer` as an independent, non-editing quality gate;
- `diagram-engineer` for architecture, wiring, sequence, state, or ER diagrams;
- `security-deep-reviewer` only when the human explicitly names it in the
  current request and accepts the extra Fable billing; never as a default
  reviewer, in a workflow fan-out, or in an Agent Team.

Do not invoke all agents for every task. The main Claude session is the
orchestrator; create a specialist only when isolation, independent review, or
parallel work provides a concrete benefit.

## Model and effort policy

Each agent definition pins its model and effort. The approved policy lives in
`validate_agent_setup.py`; `docs/ai/agentic-workflow.md` explains it. The main
session should run Opus 5.5 at high effort; the human selects it in the app,
which launched sessions at xhigh on 2026-10-14.

- Do not pass `model` or `effort` when launching a project agent, through the
  Agent tool or a workflow; a per-call value overrides the definition. The launch
  gate hook returns `ask` for Agent tool overrides and for the Fable launches it
  can detect (observed as a denial in `-p`; the app prompt is expected, not yet
  observed). Other workflow overrides are visible only afterwards in the runtime
  report.
- Do not change a session's model or effort through the app's session tools
  without an explicit human request; project settings make them ask.
- Do not store `max` effort, Ultracode, or subagent model overrides in shared
  settings; choose them per request only.
- When requested and observed model or effort differ, report it; use
  `agent_runtime_report.py` for evidence.
- A cheaper model or lower effort never removes a required test or review.

## UI delivery routing

For a substantial Web or iOS surface:

1. use `ui-ux-designer` for discovery, states, low fidelity and competing
   visual directions;
2. obtain human approval of the flow and selected direction;
3. use `web-engineer` or `ios-engineer` for implementation from the handoff;
4. use `qa-reliability-engineer` for an independent rendered visual,
   accessibility and failure-state review.

Do not ask the platform engineer to invent a brand direction during
implementation. Do not accept a high-fidelity claim without rendered evidence.
Small corrections within an approved visual system may stay with the platform
owner and do not require the full sequence.

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
- commit verified work only on the issue branch, staging only files you own by
  explicit path; never commit on `main` or `dev`; the lead owns the delivery
  gate and the pull request described in `AGENTS.md`;
- do not create nested teammates unless the human explicitly requests it.
