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

- The Grove data wires are yellow and white. Which one is the unit's TX is **not
  verified**: check M5Stack's schematic, or swap the two if you read nothing.
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

## Not verified

The frame layout comes from M5Stack's published command list (single poll
`BB 00 22 00 00 22 7E`) and the usual notification format; it has not been run
against this unit. If a tag is present but `tags=0`, read the `[rx]` lines and
compare them with the layout at the top of the sketch. The sketch sets transmit
power to 20 dBm (`TX_POWER_CENTI_DBM`, command `B6`) at boot, as M5Stack advises
for range; the command bytes are unverified, so expect a `[rx]` reply to it after
the version reply, and lower the value if the unit rejects it or the supply sags.

## Recording results

Record the tag model, distances, `readCount` per window and the T5 observation
as "not measured" where untested.
