# Hub firmware (FW-00, issue #23)

First slice of the ESP32 hub firmware: it joins Wi-Fi, synchronizes its clock and
keeps an MQTT connection to the broker with its device identity, publishing what
the [MQTT contract](../../docs/cahier-conception/10-contrats-mqtt.md) (schema 3.0)
requires of a connected hub. The hub never decides anything about access: it
executes authorized commands (not implemented yet) and reports facts.

## What this slice does

- Persists `bootCount` in NVS before any message (§8.1); if that fails the hub stays offline.
- Waits for Wi-Fi **and** a synchronized clock, then connects over TLS (MQTT 3.1.1,
  server certificate validated, `cleanSession=false`, keepalive 30 s), as the
  clientId `aegis-locker-<deviceKey>` with the `lockerId` as username (§4, §7.1).
- Before **every** attempt: a new `connectionId` and a new Last Will `OFFLINE`
  (`CONNECTION_LOST`, QoS 1, retained) with a new `messageId` and `sequence` (§15.2).
- On connection: `DEVICE_AVAILABILITY` `ONLINE` (QoS 1, retained), then
  `DEVICE_RESTARTED` once per boot (`events`, QoS 1), then a `HEARTBEAT`
  immediately and every 10 s (QoS 0) (§13.1, §14, §15.1, §18).
- Reconnects with backoff 1, 2, 4, 8, 16, then 30 s, ±20 % jitter (§18), without
  repeating `DEVICE_RESTARTED`.

## Not done yet

- No subscription to `commands` or `display`, so no unlock, acknowledgement or QR display.
- No cell bus: every compartment is reported with `UNKNOWN` states (doc 10 §14).
- No clean `OFFLINE` `SHUTDOWN` before a deliberate disconnect, no bounded local queue,
  no `DEVICE_ERROR`.
- Credentials are compiled in from `secrets.h`, not provisioned into NVS as doc 10 §4.3
  asks. Acceptable for a bench; a binary built from it holds the device password, so it
  must never be shared or committed. Provisioning to NVS is a later slice.
- RFID scans (`RFID_SCAN_COMPLETED`) are issue #32, after the thresholds of #19.

## Layout

| Path | Role |
|---|---|
| `locker-controller.ino` | Wiring only: Wi-Fi, SNTP, the three objects below |
| `src/hub_link.*` | Connection lifecycle; no hardware, host-testable |
| `src/hub_messages.*` | Builders of the three payloads; no hardware |
| `src/backoff.h`, `src/contract.h` | Reconnect schedule and contract constants |
| `src/platform.h` | `Transport` and `Platform` interfaces, the hardware boundary |
| `src/esp_platform.*` | ESP32 implementations (NVS, clock, `esp-mqtt` over TLS) |
| `tests/host/` | Host tests with fakes for the two interfaces |
| `secrets.h.example` | Template of the git-ignored `secrets.h` |

The MQTT client is the ESP-IDF `esp-mqtt` bundled with the Arduino ESP32 core: it
publishes at QoS 1, which `PubSubClient` cannot. Auto-reconnect is off because each
attempt needs its own Last Will.

## Configure

```bash
cp firmware/locker-controller/secrets.h.example firmware/locker-controller/secrets.h
```

Fill in `secrets.h` (it is git-ignored, never commit it): Wi-Fi, broker host (it must
match a `subjectAltName` of the broker certificate), `LOCKER_ID`, the device password
and the lab CA certificate. The broker's TLS listener, the lab CA and the device
account come from issue #24 (INF-01): see the [broker guide](../../infra/mqtt/README.md)
to generate the lab CA, start the 8883 listener and provision the hub account.

## Build and flash

Needs `arduino-cli` (or the one bundled with Arduino IDE 2) and the `esp32:esp32`
core. From the repository root:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/locker-controller
arduino-cli upload --fqbn esp32:esp32:esp32 --port <serial port> firmware/locker-controller
```

If the upload fails at the default 921600 baud, add `--board-options UploadSpeed=115200`
to the `upload` command (the option name was checked with `arduino-cli board details`).
Compilation was verified with core 3.3.12. Flashing and the broker connection were
**not** run by the author of this slice.

## Host tests

```bash
firmware/locker-controller/tests/host/run.sh
```

Needs a C++17 compiler and `python3`. It builds with `-Werror` and the address and
undefined-behaviour sanitizers, then checks every emitted payload is strict JSON.
The tests cover: nothing is published before network and clock are ready, the
Will / ONLINE / DEVICE_RESTARTED / HEARTBEAT order and sequences, one `connectionId`
per connection, the 10 s heartbeat, a new Will on reconnection with no second
`DEVICE_RESTARTED`, the connect timeout, a refused ONLINE, a failed boot counter,
the backoff schedule, and that the largest heartbeat fits the message buffer.

## Hardware checklist

1. `secrets.h` filled in, broker running with the TLS listener.
2. Flash, open the serial monitor at 115200 and reset the board.
3. As the backend account, subscribe to `aegis/v1/lockers/+/status` and `+/events`
   (see the hub simulator README for the observer command) and confirm: retained
   `ONLINE`, one `DEVICE_RESTARTED`, a `HEARTBEAT` every 10 s.
4. Power-cycle the board: a new `deviceSessionId`, `bootCount` + 1, one new `DEVICE_RESTARTED`.
5. Pull the board's power without a clean stop: the broker publishes the Will `OFFLINE`
   `CONNECTION_LOST` with the `connectionId` of that connection.
6. Stop the broker and restart it: the hub reconnects with a new `connectionId`, a new
   `ONLINE`, no second `DEVICE_RESTARTED`.
7. Record what was and was not observed in the pull request.
