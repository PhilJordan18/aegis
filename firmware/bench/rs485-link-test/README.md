# RS-485 link bench test (POC-02, issue #20)

Bench tool that proves one hub ↔ cell link carries **power and RS-485 data**
over a straight Cat6 cable. It is not product firmware: no MQTT, no lock, no
business logic.

## Hardware

One Freenove ESP32-WROVER camera board and one Freenove ESP32-WROOM board (the
second board reports "PSRAM chip not found"), two DKARDU auto-direction
TTL ↔ RS-485 modules, two Poyiccot RJ45 screw-terminal jacks, one straight Cat6.

| RJ45 screw | Use | Hub board | Cell board |
|---|---|---|---|
| 1 / 2 | RS-485 A+ / B− | A+ on 1, B− on 2 | **A+ on 2, B− on 1** (see below) |
| 3, 6 | reserved | not connected | not connected |
| 4 + 5 | +5 V | hub 5V pin | cell 5V pin |
| 7 + 8 | 0 V | hub GND | cell GND |

The screw numbering of the two Poyiccot breakouts did not match through the
cable: the link only worked with A and B crossed at the cell end. Before wiring
a new jack, check continuity screw-to-screw through the cable and label the jack.

On **each** board:

- DKARDU VCC → board **5V**, DKARDU GND → GND. At 3.3 V the modules did not
  drive the bus at all.
- DKARDU TXD → **GPIO 32** (ESP32 RX), DKARDU RXD → **GPIO 33** (ESP32 TX).
- With the module on 5 V, its TXD output may idle at 5 V, which the ESP32 input
  does not tolerate. Measure it; until then, put a 1 kΩ series resistor (or a
  1 kΩ / 2 kΩ divider) between TXD and GPIO 32.
- GPIO 16/17 (PSRAM on the WROVER) and 21/22/26/27 (camera) are not usable.

Rules:

- Clamp stripped wire in the screw terminals, never Dupont pins. Pull-test every wire.
- Hub powered by a USB **wall charger**, not a laptop port.
- Cell powered **only** through the cable. Unplug the Cat6 before connecting USB
  to flash or debug the cell.
- Label both jacks "NOT ETHERNET".

## Flashing with Arduino IDE

1. Install the **esp32 by Espressif Systems** board package (Boards Manager).
2. Open `rs485-link-test.ino`. Select **ESP32 Wrover Module** for the WROVER board, **ESP32 Dev Module**
   for the WROOM board, and the board's port. If upload fails at 921600, set
   Tools → Upload Speed to 115200.
3. Hub: leave `#define ROLE_HUB` near the top of the sketch. Upload.
4. Cell: change it to `#define ROLE_CELL`. Upload. **Change it back** before
   committing so the file stays in its default state.
5. `LINK_BAUD` must be the same on both boards. 115200 passed T3 on this bench.
6. Serial Monitor at **115200**, line ending "No line ending".
   Type `s` to print statistics, `r` to reset them and start a new run.

If the board has an LED on GPIO 2, the cell's toggles on each answered PING and
the hub's stays on while the cell is present. Otherwise set `STATUS_LED_PIN` to -1.

## Procedure

| Test | How | Pass |
|---|---|---|
| T0 Wiring (power off) | Multimeter continuity 1↔1, 2↔2, 4↔4, 5↔5, 7↔7, 8↔8; no short 4/5↔7/8, 1↔2 | All correct, nothing loose |
| T1 Power | Measure hub 5V pin and cell 5V pin, idle and during T3 | Cell ≥ 4.5 V, cell never reports `BROWNOUT` |
| T2 Basic link | Power up, watch the hub monitor | `[T4] cell PRESENT (first contact)` then stats with `ok` rising |
| T3 Reliability | Press `r`, let 10 000 frames run without touching anything | `[T3 RESULT] no loss`, `crc=0 bad=0` |
| T4 Unplug / replug | During a run, unplug the Cat6 for a few seconds, replug; repeat 5 times | `ABSENT` logged each time, then `PRESENT again` and `REBOOTED ... POWERON`; never `ok` while unplugged |
| T5 Soak (optional) | Leave it running 30 min after T3 | Same figures as T3, no unexpected reboot |

Run T3 at 115200; use 9600 only as a fallback if it shows errors. T4 adds timeouts on purpose: press `r`
before a T3 run so its figures stay clean.

### Reading the statistics

| Field | Meaning |
|---|---|
| `ok` | PINGs answered with the right sequence and a valid CRC |
| `timeout` | No valid answer in time (lost frame, or cell absent) |
| `crc` | A frame arrived but was corrupted, and was rejected |
| `bad` | Well-formed CRC but unexpected content, or oversized line |
| `stale` | Answer to an older PING; ignored, never counted as success |
| `echo` | Hub read back its own PING (depends on the transceiver) |
| `latency` | PING sent → valid reply parsed, including transmission time |
| `reboots` | Cell boot id changed; the reset reason is printed with it |

## Recording results

Copy the `[T3 RESULT]` lines and the T1 / T4 observations into issue #20, with
the cable length, baud rate and charger rating. Anything not measured stays
"not measured".
