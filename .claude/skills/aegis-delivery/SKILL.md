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
- committing, pushing, merging, or releasing.

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