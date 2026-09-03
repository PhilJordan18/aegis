---
name: aegis-contracts
description: Design and review Aegis REST, MQTT, domain state, and cross-component contracts with compatibility, traceability, expiry, and idempotency.
---

# Aegis Contract-First Development

Use this skill whenever a change crosses component boundaries.

Relevant boundaries include:

- React to Spring;
- iOS to Spring;
- Spring to MQTT;
- MQTT to ESP32;
- Spring to PostgreSQL;
- physical observations to business operations.

## Before implementation

Identify:

1. producer;
2. consumer;
3. request, command, event, or stored fact;
4. identifiers;
5. expected state before the interaction;
6. possible state after the interaction;
7. errors, expiry, retries, and duplicates;
8. compatibility impact.

Inspect:

- `docs/cahier-conception/communication.md`;
- domain model documentation;
- state-machine documentation;
- relevant accepted ADRs;
- existing API DTOs and MQTT payloads.

If documentation is missing, do not invent a hidden contract. Propose or create the missing contract as part of the task.

## REST rules

- The backend remains authoritative.
- Use explicit request and response DTOs.
- Do not expose persistence entities directly.
- Validate all external input server-side.
- Return stable machine-readable error codes.
- Distinguish authentication, authorization, validation, conflict, expiry, and unavailable physical state.
- Do not make a client reproduce authoritative readiness logic.
- Make retriable and non-retriable failures distinguishable.
- Treat contract-breaking changes as architecture decisions.

## MQTT rules

Use distinct topics for commands, events, and device status:

- `aegis/v1/lockers/{lockerId}/commands`
- `aegis/v1/lockers/{lockerId}/events`
- `aegis/v1/lockers/{lockerId}/status`

Include where applicable:

- `messageId`;
- `operationId`;
- `lockerId`;
- message `type`;
- `timestamp`;
- `schemaVersion`;
- expiry or validity deadline;
- compartment identifier;
- expected asset or physical identifier.

Every command requires a deterministic acknowledgement outcome.

The backend and device must both tolerate duplicate delivery.

Commands are intents. Events are immutable observations or outcomes. Do not represent the same payload as both.

## State-machine changes

For every state change, document:

- allowed origin states;
- trigger;
- guard conditions;
- resulting state;
- emitted audit information;
- idempotent duplicate behavior;
- timeout behavior;
- anomaly behavior.

Illegal transitions must fail explicitly.

## Compatibility

When changing a contract:

1. list all producers and consumers;
2. preserve compatibility when reasonably possible;
3. increment `schemaVersion` when message interpretation changes;
4. update tests for both valid and invalid payloads;
5. update documentation in the same change;
6. state the rollout or migration order.

Do not merge a producer change that leaves a known consumer incompatible.