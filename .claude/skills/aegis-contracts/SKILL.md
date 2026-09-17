---
name: aegis-contracts
description: Design and review Aegis REST, MQTT, domain state, database, and cross-component contracts with compatibility, traceability, expiry, and idempotency. Use when a change crosses a component or persistence boundary.
---

# Aegis Contract-First Development

Use this skill whenever a change crosses a boundary:

- React or iOS to Spring;
- Spring to PostgreSQL;
- Spring to MQTT;
- MQTT to ESP32;
- hub to cell;
- physical observations to business operations.

## Before implementation

Identify:

1. producer and consumer;
2. request, command, event, observation, or stored fact;
3. identifiers and correlation fields;
4. valid origin and result states;
5. errors, expiry, retries, ordering, and duplicates;
6. compatibility, migration, and rollout impact.

Read only the relevant sources:

- state vocabulary and invariants: documents 03-06;
- trust boundaries and data flow: document 07;
- database contract: document 08;
- REST contract: document 09;
- MQTT contract: document 10;
- accepted ADRs in `docs/adr/`.

If documentation is missing or contradictory, do not invent a hidden contract.
Report the gap and propose the smallest explicit correction.

## REST rules

- Keep the backend authoritative.
- Use explicit request and response DTOs.
- Never expose persistence entities.
- Validate all external input server-side.
- Return stable machine-readable error codes.
- Distinguish authentication, authorization, validation, conflict, expiry, and
  unavailable physical state.
- Make retriable and non-retriable failures distinguishable.
- Treat breaking changes as architecture decisions.

## MQTT and device rules

Keep commands, events, and status on the topics defined by document 10. Include
the required message, operation, locker, compartment, schema, time, and expiry
fields for the message type.

Every command has a deterministic acknowledgement. Backend and device both
tolerate duplicate delivery. A command is an intent; an event is an immutable
observation or outcome. Do not use one payload as both.

## State and persistence changes

For every transition, document:

- allowed origin states and trigger;
- authorization and guard conditions;
- resulting state and atomic effects;
- audit evidence;
- duplicate, timeout, retry, and anomaly behavior;
- final database constraint when an invariant is durable.

Illegal transitions fail explicitly. Application checks do not replace
database constraints for critical invariants.

## Compatibility checklist

When changing a contract:

1. list every producer and consumer;
2. preserve compatibility when reasonably possible;
3. version changed interpretation explicitly;
4. update positive and negative contract tests;
5. update the normative document in the same change;
6. state migration and rollout order;
7. do not merge a producer that leaves a known consumer incompatible.

For a concrete producer/consumer matrix and review examples, read
`references/examples.md` only when designing or reviewing a contract change.
