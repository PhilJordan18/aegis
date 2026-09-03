---
name: aegis-esp32-mqtt
description: Build the Aegis ESP32 locker controller as a safe, idempotent, non-authoritative MQTT device with testable hardware abstractions and resilient state handling.
---

# Aegis ESP32 and MQTT

## Device authority

The ESP32 executes validated backend commands.

It does not decide:

- user permissions;
- asset readiness;
- reservation validity;
- loan creation;
- business confirmation.

Never implement an offline authorization shortcut.

## Safe behavior

On boot, reset, crash, or connection loss:

- locks default to the documented safe state;
- outputs initialize deterministically;
- stale commands are not executed;
- watchdog behavior remains available;
- recovery does not duplicate a previous physical action.

Document the actual electrical safe state with the hardware owner.

## Command validation

Before execution, verify:

- topic and locker identity;
- message schema;
- `messageId`;
- `operationId`;
- command type;
- compartment;
- expiry;
- duplicate status.

Produce an acknowledgement for accepted, rejected, expired, duplicated, failed, or unsupported commands.

A duplicate command must return the known outcome without repeating unsafe actuation.

## Event behavior

Publish normalized observations and outcomes, not business decisions.

Include applicable identifiers and `schemaVersion`.

Examples:

- door opened;
- door closed;
- presence detected;
- asset identity observed;
- command acknowledged;
- command failed;
- heartbeat;
- anomaly.

## Firmware structure

Separate:

- MQTT transport;
- serialization;
- command deduplication;
- operation state machine;
- lock actuator;
- door sensor;
- presence or identity sensor;
- LEDs;
- clock and timeout handling.

Use interfaces or adapters so simulated sensors can replace physical implementations.

## Runtime behavior

- Avoid blocking the main loop.
- Debounce physical sensors.
- Use bounded retries with backoff.
- Avoid reconnect storms.
- Bound queues and payload sizes.
- Monitor heap and task behavior.
- Handle partial physical sequences and timeout explicitly.

## Security

- Use per-device credentials.
- Follow topic ACLs.
- Use encrypted MQTT for remote deployment.
- Do not commit device credentials.
- Do not accept commands for another locker.
- Avoid sensitive payload logging.

## Detection strategy

RFID UHF is a POC, not a guaranteed P0 dependency.

Keep business messages independent of the physical sensor.

Support the approved fallback such as QR or NFC identity combined with door and presence or weight observations.

## Verification

Provide:

- host-testable logic where feasible;
- MQTT simulator compatibility;
- duplicate-command tests;
- expiry tests;
- reconnect tests;
- restart-safety tests;
- sensor debounce tests;
- a documented physical hardware checklist.