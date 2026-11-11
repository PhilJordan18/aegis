# Cell firmware (FW-00, issue #23)

Firmware of one Aegis cell (A1 or A2). The cell sits at the end of its own RS-485
segment ([ADR-002](../../docs/adr/ADR-002-etoile-rs485.md)): it has no Wi-Fi, no MQTT
and no identity on the network, and it decides nothing. In this slice it only answers
the hub's `PING` with its cell address, a random boot id and its reset reason, so the
hub can report the cell `CONNECTED` and detect a cable plugged into the wrong port.
The frame is specified in the [hub README](../locker-controller/README.md#cell-link-frame-version-1).

Not done yet: lock output (#42), door input (#30) and RFID (#32).

## Wiring

Same as the cell of the POC-02 bench ([bench README](../bench/rs485-link-test/README.md)):
DKARDU transceiver on 5 V, its TXD → GPIO 32 (through 1 kΩ until its level is measured),
its RXD → GPIO 33, power and RS-485 through the cell's cable only.

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
monitor (115200) prints `cell <address> ready` with its boot id and reset code.

`src/cell_frame.h` is a copy of `firmware/locker-controller/src/cell_frame.h`, because an
Arduino sketch builds only files inside its own folder. Edit the hub's copy, then copy it
here; `firmware/locker-controller/tests/host/run.sh` fails while the two differ.
