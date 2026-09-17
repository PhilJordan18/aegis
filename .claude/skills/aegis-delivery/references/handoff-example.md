# Delivery handoff example

## Outcome

Implemented reservation creation for a `READY` asset and an authorized
technician. Concurrent attempts cannot both succeed.

## Files

- `services/api/.../reservation/`: application service and DTOs.
- `services/api/.../db/migration/`: partial unique index owned by the database engineer.
- `docs/cahier-conception/09-contrats-rest.md`: confirmed request and error behavior.

## Contracts and migrations

- REST: `POST /reservations` follows document 09; no breaking change.
- Database: new forward-only Flyway migration; recovery is a corrective forward migration.
- MQTT: no impact.

## Verification

```text
Command: <exact command actually run>
Observed: <pass/fail counts and relevant output>
Not run: <check and reason>
```

## Risks

- Hardware availability was not involved in this slice.
- Full checkout integration remains unproven.

## Next owner

QA independently runs the concurrent-reservation scenario and checks the
database constraint. It does not edit the implementation while reviewing it.

## Review behavior

A useful reviewer attempts to falsify the acceptance criteria, cites evidence,
and may return `PASS` when no defect is demonstrated. A reviewer must not invent
a style complaint simply to avoid an empty findings section.
