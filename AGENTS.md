# Aegis - Shared Project Instructions

These instructions apply to every AI-assisted task in this repository.
Use `CLAUDE.md` only for Claude Code-specific routing. Keep reusable domain
workflows in the project skills.

## Product and course context

Aegis is a Critical Asset Readiness and Chain-of-Custody Platform built for
420-5X7-SO - Ecosysteme connecte, Automne 2026.

- The laboratory is the validation environment.
- The reference market is technical maintenance and inspection teams.
- Spring Boot is the sole business authority.
- React and iOS communicate only with the backend.
- The ESP32 executes authorized commands; it never grants authorization.
- PostgreSQL is private.
- AI Vision is outside P0.

Write source code, identifiers, commits, and technical comments in English.
Write course and product documentation in French unless the task says otherwise.

## Source precedence

Use this order when sources disagree:

1. `docs/cahier-conception/02-scope.md`
2. Accepted ADRs in `docs/adr/`
3. Approved normative documents 03-10 in `docs/cahier-conception/`
4. `README.md`
5. The current issue or task
6. Informal assumptions

Document 13 is an ADR register; a proposed entry is not accepted merely because
it appears there. Never silently override the approved scope or invent a missing
contract. If a reference is empty, duplicated, wrongly titled, or contradictory,
report the documentation defect before relying on it.

## Read only what the task needs

Start with `README.md`, then route to the narrowest relevant document:

| Need | Read |
|---|---|
| Scope, P0/P1/P2, acceptance, milestones | `02-scope.md` |
| Vocabulary, states, invariants | `03-dictionnaire-de-donnees.md` |
| Domain entities and relationships | `04-modele-de-donnees-logique.md` |
| State transitions | `05-machines-a-etats.md` |
| Business algorithms and functional flows | `06-algorithmes-et-flux-fonctionnels.md` |
| Trust boundaries and data movement | `07-flux-de-donnees.md` |
| PostgreSQL, Flyway, transactions, indexes | `08-modele-physique-postgresql.md` |
| REST endpoints and errors | `09-contrats-rest.md` |
| MQTT topics, payloads, QoS, idempotency | `10-contrats-mqtt.md` |
| Stories and execution order | `11-user-story-map-p0.md` |
| Hardware topology and POC | `12-architecture-physique.md` |
| Decision status and open ADRs | `13-registre-adrs-proposes.md`, then `docs/adr/` |
| Capacity and weekly sequencing | `14-plan-iterations-semaines-4-a-15.md` |

Do not load the whole design notebook for a narrow task. Search headings and
read only the relevant sections plus directly affected contracts.

## Mandatory invariants

- Readiness is derived; it is never a freely editable boolean.
- One asset has at most one active reservation and one active loan.
- Checkout and return require coherent physical confirmation.
- A reservation or displayed QR never opens a compartment by itself.
- Expired, replayed, consumed, or wrong-compartment operations are rejected.
- Commands and events are idempotent and auditable.
- A late loan does not make an asset available.
- Returning a borrowed asset does not require that asset to be `READY`.
- Custody, audit, command, event, and operation history is not destructively erased.

## Work protocol

Before implementation:

1. Inspect the worktree and preserve unrelated changes.
2. Read the issue and only the relevant documentation.
3. Classify the work as P0, P1, P2, bug, documentation, or risk reduction.
4. Identify affected invariants, contracts, migrations, components, and owners.
5. Define measurable acceptance criteria and a short verification plan.
6. Prefer the smallest complete vertical slice.

During implementation:

- Keep domain rules out of controllers, UI clients, and firmware.
- Use DTOs at API boundaries and database constraints as final invariant guards.
- Do not hold database transactions open while waiting for MQTT or hardware.
- Comment only when explaining a non-obvious reason, invariant, tradeoff,
  compatibility constraint, safety rule, or temporary workaround. Do not narrate
  obvious code.
- Add dependencies, infrastructure, or abstractions only for a demonstrated need.
- Do not change public REST/MQTT contracts, core invariants, P0 scope,
  authentication strategy, or electrical assumptions without a documented human
  decision.

## Verification and completion

Run the smallest relevant checks first, then the affected broader suite. Never
claim success from compilation alone. Report exact commands, observed results,
tests not run, contract or migration impact, and residual risks.

The repository is currently pre-bootstrap. Do not invent build commands. Add
verified commands here or in a component-local `AGENTS.md` after that component
is initialized and the command has run successfully.

Do not commit, push, merge, release, deploy, perform destructive migrations, or
alter Git history without explicit human authorization.

## Commit convention

When a human authorizes a commit, use Conventional Commits:

```text
type(optional-scope): short imperative description
```

Use lowercase types and an English description without a trailing period:

- `feat`: add user-visible behavior or a capability;
- `fix`: correct incorrect behavior, including refactoring required for the fix;
- `docs`: change documentation only;
- `test`: add or correct tests without changing production behavior;
- `refactor`: restructure production code without changing behavior or fixing a defect;
- `perf`: improve measured performance without changing intended behavior;
- `build`: change the build system or production dependencies;
- `ci`: change continuous-integration configuration;
- `chore`: maintain tooling, repository configuration, or development workflow;
- `revert`: revert an earlier commit.

Use a concise noun scope such as `api`, `db`, `web`, `ios`, `firmware`, `docs`,
or `ai` when it adds useful context. Add `!` and a `BREAKING CHANGE:` footer for
an incompatible change. Split unrelated types into separate commits when
practical. Never use `feat` for tooling-only work or `fix` for behavior-neutral
cleanup.

## Agent and token discipline

- Default to one primary agent for small and sequential work.
- Use a skill for reusable knowledge or a repeatable workflow.
- Use a subagent only for a bounded, independent task whose isolated context is
  worth its additional token cost.
- Parallelize read-heavy exploration, independent reviews, or separate file
  ownership; do not parallelize overlapping edits.
- Use at most two or three subagents by default. Reviewers should normally be
  terminal and read-only.
- A reviewer must try to disprove correctness with evidence, but may report that
  no issue was found. Never require invented findings.

The canonical project skills live in `.claude/skills/` and are exposed to Codex
through `.agents/skills/`. Claude role definitions live in `.claude/agents/`;
Codex adapters live in `.codex/agents/`.

## Academic responsibility

Instructor and activity-specific AI rules override this file. Keep a journal of
material AI assistance, verify every generated artifact, and ensure both team
members can explain the architecture, code, tests, and decisions they submit.
