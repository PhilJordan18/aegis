---
name: aegis-delivery
description: Deliver Aegis work as controlled vertical slices with scope checks, ADR decisions, verification evidence, clean handoffs, and safe Agent Team coordination.
---

# Aegis Delivery Workflow

## Start of task

Before editing:

1. Inspect the repository and current diff.
2. Read the issue and acceptance criteria.
3. Classify the work as P0, P1, P2, bug, risk reduction, or documentation.
4. Identify affected components, contracts, invariants, and owners.
5. State assumptions and unresolved questions.
6. Create a short implementation and verification plan.

Do not overwrite unrelated work in a dirty worktree.

## Vertical-slice rule

Prefer a small end-to-end capability over a large isolated subsystem.

A complete slice may include:

- domain transition;
- persistence;
- API or MQTT contract;
- client or simulator behavior;
- tests;
- audit evidence;
- documentation.

Keep the slice narrow enough to review and demonstrate.

## Agent Team coordination

When running as an Agent Team teammate:

1. Load the skills required by the agent definition before beginning.
2. Read the shared task and identify your owned files.
3. Announce conflicts or dependency concerns before editing.
4. Do not edit files owned by another teammate.
5. Do not change a shared contract without notifying every affected owner.
6. Keep one owner per Flyway migration file.
7. Send evidence, blockers, and handoff details to the lead.

Do not run parallel edits on the same migration, state machine, API contract,
or generated file.

## Autonomy

Within a clear, reversible, in-scope task, proceed without unnecessary approval.

You may:

- select implementation details;
- add focused tests;
- improve nearby naming and structure;
- fix defects discovered directly within the task;
- create supporting documentation;
- recommend follow-up issues.

Request a human decision before:

- expanding P0;
- changing a core domain invariant;
- making an incompatible contract change;
- adding a major dependency;
- performing destructive data changes;
- changing deployment or authentication strategy;
- altering hardware electrical assumptions;
- committing, pushing, merging, or releasing;
- opening a pull request (see the delivery gate).

## ADR triggers

Create or update an ADR when a decision:

- affects more than one component;
- changes the trust boundary;
- changes authentication or authorization;
- changes API or MQTT compatibility;
- selects a physical detection strategy;
- introduces significant infrastructure;
- creates a long-term operational constraint;
- deliberately accepts an important tradeoff.

## Scope-change gate

A new P0 item is acceptable only if it is:

- required by the evaluation rubric;
- essential to the core demonstration;
- required for safety or data coherence;
- required as a validated fallback.

A P0 addition must identify a compensating cut, effort estimate, risk, and human approval.

## Verification

Run the smallest relevant checks first, then the broader affected suite.

Record:

- exact commands;
- results;
- failures;
- limitations;
- tests not run and why.

Never claim that something works solely because the code compiles.

When changing `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, or project
skills, run:

```bash
python3 .claude/skills/aegis-delivery/scripts/validate_agent_setup.py
```

Treat reported configuration errors as blocking. Documentation warnings require
human review but do not authorize an automatic rewrite of the affected source.

## Branches

Work happens on an issue branch created from an up-to-date `dev`:

```bash
git switch dev
git pull --ff-only
git switch -c <issue>-<type>-<slug>
```

`<type>` is a Conventional Commit type and `<slug>` a short kebab-case summary,
for example `25-feat-asset-catalog`. Never commit on `main` or `dev` and never
push to them; the versioned hooks in `.githooks/` reject both.

## Commits

Commit only after explicit human authorization. Before committing:

1. inspect the complete diff and staged files;
2. separate unrelated concerns into focused commits;
3. run the relevant verification;
4. use the Conventional Commit rules in `AGENTS.md`;
5. write an English imperative subject that describes the actual change;
6. include a body when the reason, tradeoff, migration, or verification is not
   obvious from the subject.

Use `fix` when restructuring is part of correcting a defect. Use `refactor`
only when observable behavior is intentionally unchanged.

## Delivery gate

No pull request is opened without this gate.

1. Re-read the issue and check every acceptance criterion as met or remaining.
2. Run the verification of this skill and record exact commands and results.
3. Confirm that no secret, generated artifact, or unrelated change is staged.
4. Write the delivery report in the handoff format below, in English.
5. Stop and present the report to the human.

Only an explicit "deliver" from the human authorizes pushing the branch and
opening the pull request into `dev`. Use the report as the pull request body
with `Closes #<issue>`, and a Conventional Commit pull request title.

Never merge a pull request. Never open a pull request into `main` unless a
human explicitly asks; `main` only receives `dev`.

## Handoff format

### Outcome

What changed and what behavior now exists.

### Files

Important files created or modified.

### Contracts and migrations

Any API, MQTT, schema, state-machine, or migration impact.

### Verification

Commands run and observed results.

### Risks

Known limitations, unresolved assumptions, or environmental gaps.

### Next owner

The specialist or human decision needed next.

For a concrete handoff and review example, read
`references/handoff-example.md` only when preparing or evaluating a handoff.
