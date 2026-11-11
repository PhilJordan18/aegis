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
3. Serial Monitor at **115200**.

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

## Bench results

2026-11-11, cell board (ESP32-WROOM), unit on USB power through the board, no metal near:

| Test | Result |
|---|---|
| T2 Empty | `readerStatus=HEALTHY tags=0` in every window |
| T3 One tag at about 10 cm | `HEALTHY tags=1`, EPC `E2004717CCC06422C2B80112` (12 bytes, PC `3400`), `readCount=30` per 3 s window, RSSI byte `CB`-`CD` (about -53 to -51 dBm) |
| T1, T4, T5 | Not measured |

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
