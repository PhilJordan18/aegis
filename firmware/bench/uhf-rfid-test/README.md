# UHF RFID bench test (M5Stack UHF RFID Unit, JRD-4035)

Bench tool that proves one ESP32 can read EPC tags from the M5Stack UHF RFID
Unit over UART and print what an `RFID_SCAN_COMPLETED` message would carry
(doc 10 §12.1). It is not product firmware: no MQTT, no RS-485, no business logic.

## Wiring

| Unit wire (Grove) | ESP32 |
|---|---|
| Black (GND) | GND |
| Red (5 V) | 5V pin, board on a USB **wall charger** |
| Unit TX | **GPIO 13** (ESP32 RX) |
| Unit RX | **GPIO 14** (ESP32 TX) |

Verified on 2026-11-11: with the two data wires one way the unit sent nothing;
swapped, every frame was valid. Label the wire that ends on GPIO 13 as the unit's TX.

- The Grove data wires are yellow and white. If the monitor shows only
  `readerStatus=UNKNOWN` and no `[rx]` line, swap them: that was the fix on the bench.
- Measure the unit's TX at idle. If it sits near 5 V, put a 1 kΩ series resistor
  (or a divider) between it and GPIO 13, as for the RS-485 modules.
- GPIO 13/14 are free on the WROOM and on the WROVER camera board. Avoid 32/33
  (RS-485 link), 16/17, 21/22/26/27, and 0/1/2/3/12/15. Change `UHF_RX_PIN` and
  `UHF_TX_PIN` if your board differs.
- The unit has a built-in antenna; keep metal away from it for the first test.

## Flashing with Arduino IDE

1. Open `uhf-rfid-test.ino`, select the board and port.
2. If upload fails at 921600, set Tools → Upload Speed to 115200 and unplug the
   unit's wires while flashing.
3. Serial Monitor at **115200**, line ending "No line ending".

| Key | Effect |
|---|---|
| `r` | Start a run: window 1 starts now. A summary prints after 20 windows (`[RUN]`) and 50 windows (`[RUN RESULT]`) |
| `s` | Print the current run summary |
| `p` | Transmit power 20 → 15 → 10 dBm → 20; restarts a running run so one run never mixes two powers |
| `d` | Hex dump of every received frame on or off (off at boot) |

In a run, a window is **present** for a tag read at least 3 times while the reader
answered; such tags carry `PRESENT` in the `[scan]` lines.

## Procedure

| Test | How | Pass |
|---|---|---|
| T1 Boot | Reset the board | `self-check OK`, then a `[rx]` line answering the version request |
| T2 Empty | No tag in range, wait 3 s | `readerStatus=HEALTHY tags=0` |
| T3 One tag | Tag about 10 cm from the unit | `HEALTHY tags=1`, the EPC and `readCount` ≥ 3 |
| T4 Range | Move the tag to 30 cm, 60 cm, 1 m | Note the distance where `readCount` drops below 3 |
| T5 Metal | Put the tag on a real tool, then in a mock compartment | Note whether it still reads |

`readerStatus=UNKNOWN` means no valid frame arrived from the unit: check power,
wiring and baud. Set `DUMP_FRAMES` to `false` once the link works.

## Decision thresholds (POC-01, issue #19)

Approved by Jimmy on 2026-11-11, **before** any POC-01 measurement. They decide ADR-003.

| Rule | Value |
|---|---|
| Window | 3 s, one poll every 100 ms (doc 10 §12.1 allows up to 10 s; checkout needs 3 s, §12.2) |
| Present | Tag read **≥ 3 times** in a window while the reader answered (doc 10 §12.2) |
| Unhealthy window | Never present and never a proof of absence (doc 10 §12.1) |
| One power | A single power setting must pass every test below; start at 20 dBm |

| Test | Setup | Pass |
|---|---|---|
| P1 Right cell | Tag inside A1's compartment, door closed. Four orientations (flat, on edge, upright, upside down) and once on a real tool. Press `r` for each, read `[RUN]` at 20 windows | `present ≥ 19/20` for every orientation and the tool |
| P2 Neighbour cell | Tag where A2's compartment sits next to A1 (real wall or mock at the real distance), read by A1's reader. `r`, read `[RUN RESULT]` | `present = 0/50` for that tag. Any `seen` count is recorded; 1–2 reads in a window are tolerated |
| P3 Outside tag | Tag held 10 cm in front of A1's closed door | `present = 0/50` |
| P4 Empty cell | No tag in or near A1 | `windowsWithATagPresent = 0/50` |
| P5 Delay | Put the tag in, close the door, press `r` at the moment it closes. 10 tries | `firstPresentWindow = 1` in **10/10** tries |
| P6 Reader cut | During a run, unplug the unit's 5 V for one window | That window reads `UNKNOWN`, never `HEALTHY tags=0` |

If P2 or P3 fails at 20 dBm, press `p` for 15 dBm, then 10 dBm, and run **P1 again** at
that power before P2–P6: a power that hides the neighbour but loses the right cell
fails. If no power passes everything, ADR-003 takes the scope's fallback (QR/NFC
identity with the door sensor, doc 12 §10). Record every run, including failures.

## Bench results

2026-11-11, cell board (ESP32-WROOM), unit on USB power through the board, no metal near:

| Test | Result |
|---|---|
| T2 Empty | `readerStatus=HEALTHY tags=0` in every window |
| T3 One tag at about 10 cm | `HEALTHY tags=1`, EPC `E2004717CCC06422C2B80112` (12 bytes, PC `3400`), `readCount=30` per 3 s window, RSSI byte `CB`-`CD` (about -53 to -51 dBm) |
| Run summary | `r` with the tag at about 10 cm: `present=20/20`, `firstPresentWindow=1`, `maxReads=26`, `healthy=20` |
| T1, T4, T5, P1–P6 | Not measured |

The single-poll command, the `no tag` reply and the tag notification layout match the
sketch. `readCount` is capped at 30 per window (one poll every 100 ms for 3 s): at 10 cm
every poll found the tag.

## Not verified

The version (`03`) and set-power (`B6`) replies at boot were not captured; whether the
20 dBm setting is applied is not verified. If a tag is present but `tags=0`, read the `[rx]` lines and
compare them with the layout at the top of the sketch. The sketch sets transmit
power to 20 dBm (`TX_POWER_CENTI_DBM`, command `B6`) at boot, as M5Stack advises
for range; the command bytes are unverified, so expect a `[rx]` reply to it after
the version reply, and lower the value if the unit rejects it or the supply sags.

## Recording results

Record the tag model, distances, `readCount` per window and the T5 observation
as "not measured" where untested.
