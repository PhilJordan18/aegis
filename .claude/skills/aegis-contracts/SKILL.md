---
name: aegis-core
description: Apply the authoritative Aegis product scope, domain vocabulary, trust model, priorities, and invariants to every architecture, implementation, review, or design task.
---

# Aegis Core

Use this skill for every Aegis task.

## Sources of truth

Before making a significant decision, inspect the relevant project documents.

Apply this precedence order:

1. `docs/cahier-conception/scope.md`
2. Accepted ADRs in `docs/adr/`
3. Approved communication and domain contracts
4. `README.md`
5. The current issue or task description
6. Informal assumptions

An issue or prompt does not silently override the approved scope.

If a requested change conflicts with the scope, state the conflict and apply the scope-change process from `aegis-delivery`.

## Product objective

Aegis is a Critical Asset Readiness and Chain-of-Custody platform.

The P0 product promise is:

- show whether an asset is ready;
- prevent unauthorized or non-compliant checkout;
- open only the expected compartment;
- confirm checkout and return from coherent physical observations;
- maintain a complete, inspectable chain of custody.

Do not reduce Aegis to inventory management.

## System authority

The Spring backend is the sole business authority.

Consequences:

- React and iOS never connect directly to PostgreSQL;
- clients never communicate directly with a locker;
- the ESP32 executes commands but never grants authorization;
- a physical action is not a completed business operation until the backend confirms it;
- PostgreSQL must not be publicly exposed;
- server-side validation remains mandatory even when clients validate inputs.

## Mandatory invariants

Preserve these invariants across all implementations:

1. An asset can have at most one active reservation.
2. An asset can have at most one active loan.
3. Checkout requires an authorized, non-expired, non-consumed operation.
4. Checkout is confirmed only after coherent physical observations.
5. Return is confirmed only after coherent physical observations.
6. An operation cannot be reused after terminal completion.
7. Duplicate commands or events cannot cause duplicate state transitions.
8. The expected compartment and expected physical identity must match the observation.
9. Readiness is derived from domain facts; it is not a freely editable boolean.
10. Every security-relevant or custody-relevant transition is auditable.

## Canonical states

Readiness:

- `READY`
- `BLOCKED`
- `UNKNOWN`

Readiness reasons include:

- `NOT_PRESENT`
- `NOT_AVAILABLE`
- `MAINTENANCE`
- `DAMAGED`
- `CALIBRATION_EXPIRED`
- `ACCESS_DENIED`
- `UNKNOWN_PHYSICAL_STATE`

Availability:

- `AVAILABLE`
- `RESERVED`
- `BORROWED`
- `UNAVAILABLE`

Operational status:

- `SERVICEABLE`
- `MAINTENANCE`
- `DAMAGED`

Calibration status:

- `NOT_REQUIRED`
- `VALID`
- `EXPIRED`
- `UNKNOWN`

Reservation:

- `ACTIVE`
- `FULFILLED`
- `CANCELLED`
- `EXPIRED`

Loan:

- `ACTIVE`
- `RETURN_PENDING`
- `COMPLETED`

Locker operation:

- `REQUESTED`
- `AUTHORIZED`
- `COMMAND_SENT`
- `DOOR_OPENED`
- `OBSERVATION_RECEIVED`
- `CONFIRMED`
- `FAILED`
- `EXPIRED`
- `ANOMALY`

Do not introduce synonymous states without updating the authoritative domain documentation and affected contracts.

## Scope discipline

P0 includes the readiness, reservation, physical checkout, automatic loan, physical return, audit, anomalies, required security, simulator, and demonstrable deployment.

P1 work begins only after P0 is integrated and stable.

P2 includes AI vision, multi-site, advanced analytics, prediction, and other research extensions.

Do not reintroduce `services/vision` into the active architecture unless a formally approved P2 task requires it.

## Decision behavior

Within the approved scope, act autonomously:

- inspect existing code before proposing a replacement;
- choose sound implementation details;
- refactor locally when it reduces risk or duplication;
- add missing tests;
- document assumptions;
- prefer the smallest complete vertical slice.

Stop and request a decision when the task requires:

- changing a public contract;
- changing a core invariant;
- expanding P0;
- performing a destructive migration;
- weakening security;
- accepting a hardware safety risk;
- adding significant infrastructure or dependencies.