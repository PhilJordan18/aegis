# Contract change examples

## Example 1 - Add a non-breaking REST field

Task: expose `expiresAt` on `LockerOperationView`.

| Question | Answer |
|---|---|
| Producer | Spring REST API |
| Consumers | iOS and React |
| Authority | Spring persists and computes the value |
| Compatibility | Additive JSON field; old clients ignore it |
| Invalid value | Missing internally is a backend defect, not a client default |
| Tests | Serialization, expiry boundary, iOS/React decoding |
| Documentation | Update document 09 and client fixtures |

Do not copy expiry logic into the clients. They may display a countdown, but
the server still decides whether the operation is expired.

## Example 2 - Evolve an MQTT command

Task: add `unlockDurationMs` to `UNLOCK_COMPARTMENT`.

Before implementation, answer:

1. Is the duration selected by the backend or fixed by firmware policy?
2. What bounds prevent an unsafe value?
3. What does an older device do when the field is present?
4. Does interpretation change require a new `schemaVersion`?
5. Is the acknowledged outcome cached for duplicate `messageId` values?
6. Which document 10 examples, simulator fixtures, and firmware tests change?

An unacceptable implementation lets the device silently choose an unbounded
duration or re-actuate when the same command is delivered again.

## Example 3 - Evidence-based review finding

```text
HIGH - Duplicate event can create two loans

Evidence: the consumer checks messageId after LoanRepository.save(), and the
database has no unique processed-message constraint.

Reproduction: deliver the same ASSET_REMOVED event concurrently twice.

Expected: one transition and the previously recorded acknowledgement.
Observed risk: both transactions can pass the pre-check and insert a loan.

Required owner: backend-security-engineer + database-engineer.
```

If no defect is demonstrated, report that no contract issue was found and list
what was examined. Never manufacture a finding to make a review look useful.
