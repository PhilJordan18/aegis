# RFID over RS-485 bench test (hub + cell + M5Stack UHF unit)

Merges [`rs485-link-test`](../rs485-link-test/README.md) and
[`uhf-rfid-test`](../uhf-rfid-test/README.md). The cell scans tags with the UHF
unit and reports the last completed scan window inside its PING reply; the hub
prints each new window. It is not product firmware: no MQTT, no lock, no business
logic. Wire the RS-485 link and the UHF unit exactly as in those two READMEs.

## Choosing what each board does

Two switches near the top of the sketch:

| Board | `ROLE_*` | `UHF_ATTACHED` | Result |
|---|---|---|---|
| Hub | `ROLE_HUB` (default) | not defined | Pings the cell, prints link stats and the cell's scan windows |
| Cell with the reader | `ROLE_CELL` | `#define UHF_ATTACHED` | Scans tags, answers PINGs with the latest window |
| Hub with the reader | `ROLE_HUB` | `#define UHF_ATTACHED` | Same as the hub, and also prints its own local scans |

To test the reader on the hub instead of the cell, define `UHF_ATTACHED` on the
hub and leave it off on the cell (the hub then shows `cell has no UHF reader
attached`). Change the role back to `ROLE_HUB` and remove `UHF_ATTACHED` before
committing so the file stays in its default state.

## Procedure

1. Run T0–T3 of the RS-485 README first. If the link does not pass, nothing
   below can work.
2. Run T1–T3 of the UHF README with the reader on the board that has it.
3. Put both together and watch the hub's monitor at 115200:

| Test | How | Pass |
|---|---|---|
| T6 Empty | No tag near the reader | `[scan] cell window=N readerStatus=HEALTHY tags=0 firstEpc=- reads=0` |
| T7 One tag | Tag about 10 cm from the unit | `tags=1`, the same EPC as on the cell's own monitor, `reads` ≥ 3 |
| T8 Reader off | Unplug the unit's 5 V | `readerStatus=UNKNOWN`, never `tags=0` with `HEALTHY` |
| T9 Link unaffected | Press `r`, run 10 000 frames with a tag present | `[T3 RESULT] no loss` |

A new `[scan]` line appears about every 3 s. `readerStatus=UNKNOWN` means the
cell got no valid frame from the unit; `cell has no UHF reader attached` means
the cell was flashed without `UHF_ATTACHED`.

## Limits

- A reply carries only the first tag of the window, plus the tag count. Use the
  cell's own monitor for the full list.
- The reply is about 110 bytes, so the reply timeout grows; at 9600 baud T3 may
  need a longer `FRAME_GAP_MS`.
- The UHF frame layout and the power command are unverified against this unit; see
  the UHF README.

## Recording results

Copy the `[scan]` lines and the `[T3 RESULT]` line into issue #20 or the RFID
issue, with distances and baud. Anything not measured stays "not measured".
