---
name: aegis-core
description: Apply the authoritative Aegis product scope, domain vocabulary, trust model, priorities, and invariants to every architecture, implementation, review, or design task.
---

# Aegis Core

Use the shared rules in `AGENTS.md` and apply this domain guidance to every
Aegis task.

## Sources of truth

Before making a significant decision, inspect only the relevant project
documents. Apply this precedence order:

1. `docs/cahier-conception/02-scope.md`
2. Accepted ADRs in `docs/adr/`
3. Approved domain and communication documents 03-10
4. `README.md`
5. The current issue or task description
6. Informal assumptions

If a requested change conflicts with scope, state the conflict and apply the
scope-change process from `aegis-delivery`.

## Product objective

Aegis is a Critical Asset Readiness and Chain-of-Custody Platform. The P0
promise is to:

- show whether an asset is ready;
- prevent unauthorized or non-compliant checkout;
- open only the expected compartment;
- confirm checkout and return from coherent physical observations;
- maintain a complete, inspectable chain of custody.

Do not reduce Aegis to inventory management.

## System authority

The Spring backend is the sole business authority:

- React and iOS never connect directly to PostgreSQL;
- clients never communicate directly with a locker;
- the ESP32 executes commands but never grants authorization;
- a physical action is not complete until the backend confirms it;
- PostgreSQL remains private;
- client validation never replaces server validation.

## Mandatory invariants

Preserve these invariants across all implementations:

1. An asset can have at most one active reservation.
2. An asset can have at most one active loan.
3. Checkout requires an authorized, non-expired, non-consumed operation.
4. Checkout and return require coherent physical observations.
5. A terminal operation cannot be reused.
6. Duplicate commands or events cannot repeat a transition.
7. The compartment and physical identity must match the expected values.
8. Readiness is derived from domain facts.
9. Security- and custody-relevant transitions are auditable.

## Canonical states

- Readiness: `READY`, `BLOCKED`, `UNKNOWN`.
- Availability: `AVAILABLE`, `RESERVED`, `BORROWED`, `UNAVAILABLE`.
- Operational status: `SERVICEABLE`, `MAINTENANCE`, `DAMAGED`.
- Calibration: `NOT_REQUIRED`, `VALID`, `EXPIRED`, `UNKNOWN`.
- Reservation: `ACTIVE`, `FULFILLED`, `CANCELLED`, `EXPIRED`.
- Loan: `ACTIVE`, `RETURN_PENDING`, `COMPLETED`.
- Locker operation: `REQUESTED`, `AWAITING_LOCAL_PROOF`, `AUTHORIZED`,
  `COMMAND_SENT`, `COMMAND_ACKNOWLEDGED`, `DOOR_OPENED`,
  `OBSERVATION_RECEIVED`, `CONFIRMED`, `FAILED`, `EXPIRED`, `ANOMALY`.

Do not introduce synonymous states without updating the authoritative domain
documentation and every affected contract.

## Scope discipline

P0 includes readiness, reservation, physical checkout, automatic loan,
physical return, audit, anomalies, required security, a simulator, and a
demonstrable deployment.

P1 starts only after P0 is integrated and stable. P2 includes AI Vision,
multi-site behavior, advanced analytics, prediction, and research extensions.

Within approved scope, inspect existing work, choose sound implementation
details, add focused tests, document assumptions, and prefer the smallest
complete vertical slice.

Request a human decision before changing a public contract, core invariant,
P0 scope, authentication strategy, destructive migration, significant
dependency, or hardware safety/electrical assumption.
