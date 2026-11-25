# Hub firmware (FW-00 #23, FW-01 #30, FW-02 #32, FW-04 #45)

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
  soon as **another** cell answers on that port (a swapped cable). While the link is `CONNECTED`,
  `lockState` and `readerStatus` are what the cell put in its last counted answer; otherwise both
  are `UNKNOWN`, never the last value seen. `doorState` stays `UNKNOWN` (no door sensor yet).
  A cell restart (new boot id) and each state change are logged on the serial monitor only.
- Asks each `CONNECTED` cell for an RFID scan window (3 s, POC-01 thresholds of #19): once the
  link comes up, each time the latch goes from `UNLOCKED` to `LOCKED`, and every 30 s. When the
  window is done it fetches every tag, then publishes `RFID_SCAN_COMPLETED` on `events` (QoS 1,
  §12.1) **without** `operationId`, as a monitoring scan outside an operation (§20):
  `windowStartedAt` / `windowEndedAt` (to the second), the window's `readerStatus` and each tag's
  EPC with its `readCount`. An empty list with `HEALTHY` means a complete window saw no tag. The
  backend decides presence (at least 3 reads, §12.2). A scan interrupted by a lost link, a cell
  restart or while the hub is offline is dropped, never queued.

- Subscribes to `display` (QoS 1, on every connection) and handles each message of doc 10 §27
  in `DisplayInbox`. A redelivered `messageId` gets its known answer again without a redraw. A new
  one is refused, in this order, with the §27.2 reason:
  - schema, field, locker or cell invalid: `INVALID_DISPLAY_PAYLOAD`;
  - `targetDeviceSessionId` not this boot: `TARGET_SESSION_MISMATCH`;
  - clock not synchronized or no screen: `SCREEN_UNAVAILABLE`;
  - deadline passed: `DISPLAY_EXPIRED`;
  - revision not above the highest one accepted this boot: `STALE_DISPLAY_REVISION`.

  A refused message never changes what is on screen. An accepted challenge is sent to the screen as
  the §27.1 URI, and `ACCESS_CHALLENGE_DISPLAYED` goes out only once the display node proves the
  draw (see "Display link frame"); a failed or timed-out draw, or one replaced by a newer accepted
  instruction before it was proven, is `SCREEN_UNAVAILABLE`. A redelivery while the draw is pending
  gets no answer and no new frame; once resolved it gets the known answer. A draw resolved while
  offline publishes nothing: the answer goes out on the redelivery. An accepted `DISPLAY_OPERATION_STATUS` replaces the QR
  with its predefined message, with no positive acknowledgement. The local deadline is
  `min(expiresAt, issuedAt + 60 s)` for a challenge and `+ 30 s` for a status, so a late message
  never gets a new window. The screen returns to idle at that deadline even without a clearing
  message, on a lost MQTT connection (for a QR) and at every boot. The token is never logged,
  never published and is wiped once drawn.

## Not done yet

- **The CYD side is not written yet:** the hub drives the display node over I2C (below), but the
  Freenove ESP32 CYD (3.2", 240x320) sketch that answers it is a later slice. Until it exists the
  hub hears no status, `available()` stays false and every challenge is refused
  `SCREEN_UNAVAILABLE`. The I2C link has only run against the host fake, not on a real bus.
- `compartmentCode` is checked as at most 8 characters of `A-Z`, `0-9`, `_` (the frame carries 8
  printable ASCII); a longer or non-ASCII code is refused `INVALID_DISPLAY_PAYLOAD`. The backend
  does not bound `compartments.code` yet, so such a cell would never get a QR.

- `commands` is subscribed (QoS 1, on every connection) and checked (retained, uncorrelable, schema,
  locker, cell, clock, `expiresAt`, duplicates). A command is persisted in NVS (one record per slot,
  64 slots) as EXECUTING before `HubLink::onCommand`'s handler runs; a restart turns it into
  `PREVIOUS_EXECUTION_UNCERTAIN`, reported once. Answers: `COMMAND_ACKNOWLEDGED`, `COMMAND_REJECTED`,
  and `INBOUND_MESSAGE_INVALID` (one per case per 60 s). No handler is wired, so every valid command
  is rejected `INTERNAL_DEVICE_ERROR` until the solenoid slice sets one.
- Journal limits: the uncertain report is kept in RAM only (a second reboot before it is published
  loses it, a redelivery still gets the known rejection); a message over 1.5 KB is dropped without
  `INBOUND_MESSAGE_INVALID`; a record layout change makes old records read as empty.
- `doorState` stays `UNKNOWN`: no cell has a door sensor yet (#30), so the latch closing stands in
  for the door closing as the scan trigger.
- Scans never carry an `operationId`: correlating a scan with an operation arrives with the lock
  command (#42).
- A reader whose 5 V or ground is cut can still answer through its data wires (seen on the bench,
  2026-11-11) and so read `HEALTHY` with no working radio. Health from the serial line alone is
  therefore not proof that tags can be read; to be settled with PHY-02 (#31).
- A change of `connectionStatus`, `lockState` or `readerStatus` waits for the next 10 s heartbeat;
  no `LOCK_LOCKED` / `LOCK_UNLOCKED` event is published for it yet (§11.2, with #42).
- No clean `OFFLINE` `SHUTDOWN` before a deliberate disconnect, no bounded local queue,
  no `DEVICE_ERROR`.
- Credentials are compiled in from `secrets.h`, not provisioned into NVS as doc 10 §4.3
  asks. Acceptable for a bench; a binary built from it holds the device password, so it
  must never be shared or committed. Provisioning to NVS is a later slice.

## Layout

| Path | Role |
|---|---|
| `locker-controller.ino` | Wiring only: Wi-Fi, SNTP, UART and I2C pins, the objects below |
| `src/hub_link.*` | Connection lifecycle; no hardware, host-testable |
| `src/hub_messages.*` | Builders of the three payloads; no hardware |
| `src/display_inbox.*` | `display` checks, deadline, revision, duplicates, pending draws and the `Display` interface; host-testable |
| `src/i2c_display.*` | `Display` over I2C toward the CYD display node: one bus transaction per loop, retries, bus reset; host-testable |
| `src/display_frame.h` | Hub ↔ display node frame, self-contained so the CYD sketch can carry a byte-identical copy |
| `src/cell_link.*` | Presence of the cell on one port: poll, timeout, wrong-cell check; host-testable |
| `src/cell_frame.h` | Hub ↔ cell frame; copied in `firmware/cell-controller/src/`, `run.sh` checks the copies match |
| `src/backoff.h`, `src/contract.h` | Reconnect schedule and contract constants |
| `src/platform.h` | `Transport`, `CellPort`, `I2cBus` and `Platform` interfaces, the hardware boundary |
| `src/esp_platform.*` | ESP32 implementations (NVS, clock, `esp-mqtt` over TLS, UART ports, I2C over `Wire`) |
| `tests/host/` | Host tests with fakes for the interfaces |
| `secrets.h.example` | Template of the git-ignored `secrets.h` |

The MQTT client is the ESP-IDF `esp-mqtt` bundled with the Arduino ESP32 core: it
publishes at QoS 1, which `PubSubClient` cannot. Auto-reconnect is off because each
attempt needs its own Last Will.

## Cell link frame (version 3)

The hub ↔ cell protocol of each RS-485 segment, required by doc 12 §5 before
implementation. It is Aegis's own format, kept from the POC-02 bench (issue #20,
10,000 / 10,000 frames at 115200 baud), and is **not Modbus**.

| Item | Value |
|---|---|
| Line | 115200 baud, 8N1, half duplex, auto-direction transceivers |
| Frame | One ASCII line: `<body>,<CRC>\n`. CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) of `<body>`, 4 uppercase hex. `\r` is ignored. At most 63 characters, longer lines are dropped |
| PING (hub → cell) | `P,<seq>`: `seq` is 8 uppercase hex, incremented on every poll |
| SCAN (hub → cell) | `S,<seq>`: starts a 3 s scan window unless one is running; answered by a REPLY. The hub sends it on each poll until a REPLY shows the window running |
| TAG? (hub → cell) | `T,<seq>,<index>`: asks for tag `index` (2 hex) of the finished window; answered by a TAG |
| REPLY (cell → hub) | `R,<seq>,<cellAddress>,<bootId>,<resetCode>,<lock><reader>,<scan><tagCount><scanReader>`: echoed `seq`, address 2 hex (A1 = `01`, A2 = `02`), random boot id 8 hex, `esp_reset_reason()` 2 hex; the latch (`L` locked, `U` unlocked, `?` unknown) and the UHF reader between scans (`H` healthy, `F` faulted, `?` unknown); the scan (`I` no result, `W` window running, `D` done), the finished window's tag count (2 hex, at most 8) and its reader verdict (`H`, `F`, `?`, or `-` when there is no finished window) |
| TAG (cell → hub) | `E,<seq>,<cellAddress>,<index>,<readCount>,<EPC>`: index 2 hex, read count 4 hex, EPC 2 to 32 uppercase hex |
| Example | `P,0000001A,` + CRC, answered by `R,0000001A,01,B0071D01,01,LH,D01H,` + CRC; `T,0000001B,00,` + CRC answered by `E,0000001B,01,00,001E,E2004717CCC06422C2B80112,` + CRC |
| Version | Version 2 added `<lock><reader>`, version 3 the scan fields and the SCAN, TAG? and TAG frames. An older reply no longer parses, so the hub reports such a cell `DISCONNECTED`: flash the hub and the cells together |
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

## Display link frame (version 1)

The hub ↔ CYD display node protocol ([ADR-019](../../docs/adr/ADR-019-ecran-hub-noeud-cyd-i2c.md)).
Binary, Aegis's own format, defined in `src/display_frame.h`.

| Item | Value |
|---|---|
| Bus | I2C, hub master, CYD slave address `0x42`, 100 kHz, 4.7 kΩ external pull-ups to 3.3 V. Hub SDA GPIO 21, SCL GPIO 22 (free once the camera module is removed; not 26/27, 27 is the latch switch) |
| Command (master write) | `0xAE`, version `0x01`, `cmd`, `seq` u32 LE, `len`, `payload[len]`, CRC-16/CCITT-FALSE big endian over everything before it. At most 255 bytes |
| `SHOW_CHALLENGE` `0x01` | `ttlMs` u16 LE, `action` (0 CHECKOUT, 1 RETURN), `codeLen` + code (≤ 8 printable ASCII), `uriLen` + URI (≤ 230) |
| `SHOW_STATUS` `0x02` | `ttlMs`, `action`, `codeLen` + code, `statusLen` + status (≤ 24 printable ASCII; the CYD shows a generic screen for a status it does not know) |
| `CLEAR` `0x03`, `PING` `0x04` | Empty payload |
| Status (master read, 16 bytes) | `0xEA`, version, `fwVer`, `bootId` u32 LE, `seq` u32 LE of the last frame handled, `state` (0 IDLE, 1 DRAWING, 2 SHOWN, 3 FAILED), `err` (0 NONE, 1 BAD_CRC, 2 BAD_LEN, 3 BAD_VERSION, 4 UNKNOWN_CMD, 5 URI_TOO_LONG, 6 DRAW_FAILED), reserved, CRC-16 BE of the first 14 bytes |
| `ttlMs` | Time left to the hub's local deadline, rounded down, at most 60000. The hub also sends `CLEAR` at that deadline and, for a QR, when the MQTT connection is lost |
| Proof of draw | A valid status with `state` SHOWN and the `seq` we sent; any other `seq` is stale and ignored. `seq` starts at a random value at boot and grows by one per frame |
| Timing | Idle: `PING` then a status read every 1 s. Draw pending: a status read every 20 ms, given up after 1 s. `available()` is true only after a valid status in the last 3 s |
| Errors | A NACK or timeout is retried on the next loop, 3 writes at most; `BAD_CRC` for our `seq` is resent once. After 5 failures in a row the bus is reset (9 SCL pulses, STOP, `Wire` restarted), at most once per 5 s. Any failure answers `SCREEN_UNAVAILABLE` and sends `CLEAR` |
| Secrets | Only `cmd`, `seq` and `err` are logged. The frame holding the token is zeroed once its draw is resolved (shown, failed, timed out or replaced), at most 1 s after the write |

`I2cDisplay::loop()` does at most one bus transaction per call (a write or a 16-byte read, each
bounded by the 50 ms `Wire` timeout).

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
staying independent, and the heartbeat carrying each cell's status. For the display node, against
a scripted fake CYD: the frame CRC check value, round trips and refused frames, the 218-character
URI fitting and a 231-character one refused, `available()` over time, the acknowledgement only
after SHOWN with our `seq` (stale SHOWN, FAILED and timeout give `SCREEN_UNAVAILABLE` and `CLEAR`),
redelivery while pending, a superseded pending challenge, write retries and the one CRC resend, the
rate-limited bus reset, `CLEAR` at the deadline and on connection loss, one bus transaction per
loop, the compartment code limits, and no token left in logs, messages or driver memory.
`run.sh` also fails if the two copies of `cell_frame.h` differ.

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
