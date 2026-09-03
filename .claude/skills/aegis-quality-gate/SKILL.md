---
name: aegis-quality-gate
description: Audit Aegis changes for correctness, security, performance, resilience, scope compliance, and reproducible end-to-end acceptance.
---

# Aegis Quality Gate

QA is an independent evidence-based gate.

QA does not approve its own assumptions and does not silently repair production code during a review.

## Review order

1. Scope and acceptance criteria
2. Domain invariants
3. Contract compatibility
4. Security and authorization
5. Transaction and data integrity
6. Idempotency and failure recovery
7. Client behavior and accessibility
8. IoT behavior and physical coherence
9. Performance and resource use
10. Documentation and reproducibility

## Required scenarios

At minimum, evaluate relevant variations of:

- READY asset succeeds;
- BLOCKED asset is refused;
- unauthorized user is refused;
- expired authorization is refused;
- consumed operation is refused;
- wrong compartment is detected;
- wrong asset or inconsistent observation becomes an anomaly;
- duplicate command does not reopen or retransition;
- duplicate event does not create a second loan or return;
- disconnect and reconnect converge safely;
- backend restart does not lose authoritative state;
- device restart returns to a safe state;
- concurrent reservations do not both succeed;
- concurrent checkout attempts do not create two loans;
- no manual database correction is required.

## Performance review

Measure before recommending optimization.

Inspect:

- query count per API request;
- N+1 behavior;
- slow queries and execution plans;
- missing or unused indexes;
- transaction duration;
- lock contention;
- API latency;
- UI unnecessary rerenders or refetches;
- MQTT retry storms;
- ESP32 blocking loops and heap behavior.

Do not accept an optimization that weakens correctness or auditability.

## Severity

- `CRITICAL`: security breach, unsafe hardware behavior, custody corruption, or destructive data risk.
- `HIGH`: P0 scenario cannot complete or invariant can be violated.
- `MEDIUM`: important reliability, usability, performance, or maintainability defect.
- `LOW`: localized improvement with limited product impact.

## Verdicts

Use exactly one:

- `PASS`
- `PASS WITH RISKS`
- `FAIL`

A pass requires observable evidence.

The final P0 demonstration gate requires:

- 10 consecutive successful checkouts;
- 10 consecutive successful returns;
- no manual database intervention;
- correct rejection of invalid scenarios;
- an inspectable audit trail;
- convergence within the documented target.

## Report format

### Verdict
PASS, PASS WITH RISKS, or FAIL.

### Scope tested
What was and was not examined.

### Evidence
Commands, tests, logs, screenshots, measurements, or traces.

### Findings
Ordered by severity, each with reproduction steps and owner.

### Performance
Measured results and baselines.

### Residual risks
Anything not proven.

### Required follow-up
The smallest concrete actions required before approval.