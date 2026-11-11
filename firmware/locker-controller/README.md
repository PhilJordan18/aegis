# Hub firmware (FW-00, issue #23)

ESP32 hub firmware: it joins Wi-Fi, synchronizes its clock, keeps an MQTT
connection to the broker with its device identity, publishing what the
[MQTT contract](../../docs/cahier-conception/10-contrats-mqtt.md) (schema 3.0)
requires of a connected hub, and polls cells A1 and A2 over two independent RS-485
segments ([ADR-002](../../docs/adr/ADR-002-etoile-rs485.md)). The cell side is
[`firmware/cell-controller`](../cell-controller/README.md). The hub never decides anything about access: it
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
- Polls each cell on its own port every 100 ms (frame below). The heartbeat reports each
  compartment's `connectionStatus`: `UNKNOWN` until the first result, `CONNECTED` once the
  expected cell answers, `DISCONNECTED` after 3 polls in a row without a valid answer or as
  soon as **another** cell answers on that port (a swapped cable). Door, lock and reader stay
  `UNKNOWN`. A cell restart (new boot id) is logged on the serial monitor only.

## Not done yet

- `commands` is subscribed (QoS 1, on every connection) and checked (retained, uncorrelable, schema,
  locker, cell, clock, `expiresAt`, duplicates). A command is persisted in NVS (one record per slot,
  64 slots) as EXECUTING before `HubLink::onCommand`'s handler runs; a restart turns it into
  `PREVIOUS_EXECUTION_UNCERTAIN`, reported once. Answers: `COMMAND_ACKNOWLEDGED`, `COMMAND_REJECTED`,
  and `INBOUND_MESSAGE_INVALID` (one per case per 60 s). No handler is wired, so every valid command
  is rejected `INTERNAL_DEVICE_ERROR` until the solenoid slice sets one. `display` is not subscribed.
- Journal limits: the uncertain report is kept in RAM only (a second reboot before it is published
  loses it, a redelivery still gets the known rejection); a message over 1.5 KB is dropped without
  `INBOUND_MESSAGE_INVALID`; a record layout change makes old records read as empty.
- Cells report only their link: `readerStatus`, `doorState` and `lockState` stay `UNKNOWN`
  until #30 (door and lock), #42 (lock command) and #32 (RFID).
- A change of `connectionStatus` waits for the next 10 s heartbeat; no event is published for it.
- No clean `OFFLINE` `SHUTDOWN` before a deliberate disconnect, no bounded local queue,
  no `DEVICE_ERROR`.
- Credentials are compiled in from `secrets.h`, not provisioned into NVS as doc 10 §4.3
  asks. Acceptable for a bench; a binary built from it holds the device password, so it
  must never be shared or committed. Provisioning to NVS is a later slice.
- RFID scans (`RFID_SCAN_COMPLETED`) are issue #32, after the thresholds of #19.

## Layout

| Path | Role |
|---|---|
| `locker-controller.ino` | Wiring only: Wi-Fi, SNTP, UART pins, the objects below |
| `src/hub_link.*` | Connection lifecycle; no hardware, host-testable |
| `src/hub_messages.*` | Builders of the three payloads; no hardware |
| `src/cell_link.*` | Presence of the cell on one port: poll, timeout, wrong-cell check; host-testable |
| `src/cell_frame.h` | Hub ↔ cell frame; copied in `firmware/cell-controller/src/`, `run.sh` checks the copies match |
| `src/backoff.h`, `src/contract.h` | Reconnect schedule and contract constants |
| `src/platform.h` | `Transport`, `CellPort` and `Platform` interfaces, the hardware boundary |
| `src/esp_platform.*` | ESP32 implementations (NVS, clock, `esp-mqtt` over TLS, UART ports) |
| `tests/host/` | Host tests with fakes for the interfaces |
| `secrets.h.example` | Template of the git-ignored `secrets.h` |

The MQTT client is the ESP-IDF `esp-mqtt` bundled with the Arduino ESP32 core: it
publishes at QoS 1, which `PubSubClient` cannot. Auto-reconnect is off because each
attempt needs its own Last Will.

## Cell link frame (version 1)

The hub ↔ cell protocol of each RS-485 segment, required by doc 12 §5 before
implementation. It is Aegis's own format, kept from the POC-02 bench (issue #20,
10,000 / 10,000 frames at 115200 baud), and is **not Modbus**.

| Item | Value |
|---|---|
| Line | 115200 baud, 8N1, half duplex, auto-direction transceivers |
| Frame | One ASCII line: `<body>,<CRC>\n`. CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) of `<body>`, 4 uppercase hex. `\r` is ignored. At most 47 characters, longer lines are dropped |
| PING (hub → cell) | `P,<seq>`: `seq` is 8 uppercase hex, incremented on every poll |
| REPLY (cell → hub) | `R,<seq>,<cellAddress>,<bootId>,<resetCode>`: echoed `seq`, address 2 hex (A1 = `01`, A2 = `02`), random boot id 8 hex, `esp_reset_reason()` 2 hex |
| Example | `P,0000001A,` + CRC, answered by `R,0000001A,01,B0071D01,01,` + CRC |
| Timing | Hub polls every 100 ms, waits 30 ms for the reply; the cell answers 2 ms after the PING so the hub's transceiver is back in receive |
| Counted as an answer | Valid CRC, current `seq`, received before the hub gave up on that PING. A reply to an older PING, the hub's own PING echoed back, a corrupted or oversized frame never counts |

One segment per cell, each on its own hub UART ([ADR-002](../../docs/adr/ADR-002-etoile-rs485.md)):

| Port | Cell | Hub UART | Hub RX ← transceiver TXD | Hub TX → transceiver RXD |
|---|---|---|---|---|
| 1 | A1 | `Serial2` | GPIO 32 | GPIO 33 |
| 2 | A2 | `Serial1` | GPIO 13 | GPIO 14 |

Port 1 keeps the bench wiring. On the Freenove WROVER camera board, GPIO 16/17 are PSRAM and
4, 5, 18-27 and 34-39 belong to the camera, which leaves 13/14 for port 2. Wire port 2's
transceiver like the bench: VCC on 5 V, and a 1 kΩ series resistor on its TXD until its
output level is measured (see the [bench README](../bench/rs485-link-test/README.md)).

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
Compilation was verified with core 3.3.12. The broker connection over TLS was run on
staging with this hub (issue #24). On 2026-11-11, port 1 was run with one cell (the
bench boards, Cat6, 115200 baud): `CONNECTED`, unplug detected and replug with the
cell's restart logged, and a cell flashed with address 2 refused on port 1. Port 2 and a
real A2 were **not** run: no second cell exists yet. These boards needed
`--board-options UploadSpeed=115200` to flash.

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
the backoff schedule, and that the largest heartbeat fits the message buffer. For the
cells: the frame and its CRC check value, oversized lines, `UNKNOWN` → `CONNECTED`,
`DISCONNECTED` after 3 misses and recovery, a cell on the wrong port, stale, echoed,
corrupted and late replies, a reply read after a busy loop, poll pacing, the two ports
staying independent, and the heartbeat carrying each cell's status. `run.sh` also fails
if the two copies of `cell_frame.h` differ.

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
7. Flash `firmware/cell-controller` on A1 with `CELL_ADDRESS 1` and on A2 with `2`, wire them
   to ports 1 and 2: both report `CONNECTED` in the next heartbeat.
8. Unplug A2's cable: within 10 s A2 is `DISCONNECTED` and A1 stays `CONNECTED`. Replug:
   `CONNECTED` again and the hub's serial monitor logs A2's restart.
9. Plug A2's cable into port 1 and A1's into port 2: both report `DISCONNECTED`, and the
   serial monitor names the address that answered on each port.
10. Record what was and was not observed in the pull request.
