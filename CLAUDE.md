# Aegis — Project Instructions

## Sources of truth

Use this precedence order:

1. `docs/cahier-conception/scope.md`
2. Accepted ADRs in `docs/adr/`
3. Approved domain and communication contracts
4. `README.md`
5. Current issue or task
6. Informal assumptions

Do not silently override the approved scope.

## Product

Aegis is a Critical Asset Readiness and Chain-of-Custody Platform.

The laboratory is the validation environment.
The reference market is technical maintenance and inspection teams.

## Mandatory architecture

- Spring Boot is the sole business authority.
- React and iOS communicate only with the backend.
- ESP32 executes commands but never grants authorization.
- Checkout and return require coherent physical confirmation.
- Readiness is derived and cannot be edited as a free boolean.
- Commands and events must be idempotent and auditable.
- PostgreSQL must not be publicly exposed.
- AI Vision is outside P0.

## Task workflow

Before implementation:

1. Inspect the current worktree.
2. Read the issue and relevant documentation.
3. Classify the work as P0, P1, P2, bug, documentation, or risk reduction.
4. Identify affected contracts, invariants, files, and owners.
5. Define measurable acceptance criteria.
6. Produce a short plan.

Prefer complete vertical slices over isolated technical work.

Do not commit, push, merge, release, perform destructive migrations,
expand P0, or change public contracts without explicit human authorization.

## Agent routing

Use:

- `solution-architect` for architecture, contracts, ADRs, and cross-component planning.
- `ui-ux-designer` before substantial UI implementation.
- `backend-security-engineer` for Spring Boot and security.
- `database-engineer` for PostgreSQL, Flyway, transactions, and query performance.
- `web-engineer` for React administration.
- `ios-engineer` for SwiftUI technician workflows.
- `firmware-engineer` for ESP32, sensors, locks, and MQTT device behavior.
- `qa-reliability-engineer` as the independent quality gate.
- `diagram-engineer` for any architecture, wiring, sequence, state, or ER diagram.

## Agent Team protocol

Agent Teams coordinate Claude sessions inside one local Claude Code session.
They do not replace Git, branches, pull requests, or communication between humans.

Use Agent Teams only when the work can be divided into independent deliverables.

Default to two or three teammates. Add more only when each teammate owns a
separate, clearly bounded set of files.

Before implementation, the lead must:

1. Assign file ownership.
2. Define task dependencies.
3. Identify shared contracts.
4. Prevent concurrent edits to the same file.
5. Keep Flyway migrations owned by `database-engineer`.

When running as an Agent Team teammate:

- Do not assume the agent definition's `skills` field was preloaded.
- Invoke every skill listed in your agent's “Required skills” section.
- Announce file ownership before editing.
- Do not edit a file owned by another teammate.
- Send blockers, contract changes, and migration concerns to the relevant owner.
- Do not claim a task complete without verification evidence.

## Completion

Do not claim completion without:

- relevant tests or validation;
- commands and observed results;
- contract and migration impact;
- known risks;
- documentation updates where required;
- a clear next owner when work remains.