# Cell firmware (FW-00 #23, FW-01 #30)

Firmware of one Aegis cell (A1 or A2). The cell sits at the end of its own RS-485
segment ([ADR-002](../../docs/adr/ADR-002-etoile-rs485.md)): it has no Wi-Fi, no MQTT
and no identity on the network, and it decides nothing. It answers each hub `PING` with
its cell address, a random boot id, its reset reason, its **latch state** and its **UHF
reader health**. The hub puts the last two in the heartbeat as `lockState` and
`readerStatus` (doc 10 §14). The frame is specified in the
[hub README](../locker-controller/README.md#cell-link-frame-version-2).

| Reported | How the cell decides |
|---|---|
| `LOCKED` / `UNLOCKED` | Latch status switch on GPIO 27 with a pull-up, 30 ms debounce. Contact open = striker held = `LOCKED`, closed = striker out = `UNLOCKED` (POC-03 L0, [#21](https://github.com/PhilJordan18/aegis/issues/21)). A cut switch wire also reads open, so it reports `LOCKED`: a 2-wire dry contact cannot tell them apart |
| `HEALTHY` / `FAULTED` | One single poll to the reader every second. Any valid reader frame (tag or "no tag") = `HEALTHY`; 3 polls in a row without one = `FAULTED`; `UNKNOWN` before either. Provisional until PHY-02 (#31) |

Not done yet: firing the lock (#42; the gate output is only held low), the door sensor (#30)
and the RFID scans themselves (#32). The tags the reader sees are ignored for now.

## Wiring

| Signal | Cell GPIO | Goes to |
|---|---|---|
| RS-485 RX | 32 | Transceiver TXD (through 1 kΩ until its level is measured) |
| RS-485 TX | 33 | Transceiver RXD |
| UHF RX | 13 | UHF unit's TX (the wire that carries its replies, found on the #19 bench) |
| UHF TX | 14 | UHF unit's RX |
| Lock gate | 25 | MOSFET module TRIG, 10 kΩ to GND; driven low before it becomes an output |
| Latch switch | 27 | Latch white wire; yellow to GND |

The transceiver is wired as on the POC-02 bench ([bench README](../bench/rs485-link-test/README.md)),
on 5 V, with power and RS-485 through the cell's cable only. The lock's 12 V side is described in
the lock bench of POC-03 ([#21](https://github.com/PhilJordan18/aegis/issues/21)).

## Build and flash

Set the address at the top of `cell-controller.ino`: `#define CELL_ADDRESS 1` for A1,
`2` for A2. Set it back to `1` before committing. Or leave the file unchanged and pass it
on the command line. From the repository root:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 --build-property "compiler.cpp.extra_flags=-DCELL_ADDRESS=2" firmware/cell-controller
```

```bash
arduino-cli upload --fqbn esp32:esp32:esp32 --port <serial port> firmware/cell-controller
```

Unplug the cell's cable before connecting USB to flash or debug it. At start-up the serial
monitor (115200) prints `cell <address> ready` with its boot id and reset code, then a line
`cell <address>: lock …, reader …` each time either state changes.

`src/cell_frame.h` is a copy of `firmware/locker-controller/src/cell_frame.h`, because an
Arduino sketch builds only files inside its own folder. Edit the hub's copy, then copy it
here; `firmware/locker-controller/tests/host/run.sh` fails while the two differ.

`src/cell_state.h` holds the reader health, the latch debounce and the UHF frame check, with
the time passed in; `tests/host/test_cell.cpp` tests it and `run.sh` builds it.
