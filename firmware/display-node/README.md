# Display node firmware (FW-04, issue #45; POC-04, issue #22)

Bench firmware of the hub screen: a Freenove ESP32 Display 3.2" (FNK0103, LCDWiki E32R32P,
ST7789 240 × 320). It is the display node of the hub screen design of ADR-019
(`docs/adr/ADR-019-ecran-hub-noeud-cyd-i2c.md`): no Wi-Fi, no MQTT and no network identity, it decides nothing.

It is the I2C slave of the hub: it draws the screen the hub sends, proves each draw through its
status, and clears itself. The hub side and the frame reference are in
`firmware/locker-controller` (README, "Display link frame", and `src/i2c_display.*`).

- Screens: the Aegis home screen, the QR challenge with its countdown, and the result screens
  `CONFIRMED`, `EXPIRED`, `FAILED` and `ANOMALY` (French text, the contract's predefined
  messages); any other status gets a generic "Statut de l’opération" screen. The screens show the
  action (`Retrait` or `Retour`) and the compartment code, never a person's name (doc 10 §27.1).
- The QR holds the URI the hub sends. The old demo loop (fixed test QR, 7 px modules) is removed;
  it is in the git history of `45-feat-display-screen`.

## I2C link

| Item | Value |
|---|---|
| Role | I2C slave at `0x42`, 100 kHz. No Wi-Fi, no MQTT, no network identity |
| Wiring | CYD 4-pin I2C connector: SDA IO32, SCL IO25 → hub SDA GPIO 21, SCL GPIO 22; GND common; 4.7 kΩ pull-ups to 3.3 V on SDA and SCL (which side carries them is a bench item) |
| Frame | Version 1, `src/display_frame.h`, a byte-identical copy of the hub's file (do not edit it here) |
| Commands | `SHOW_CHALLENGE` (ttlMs, action, code, URI), `SHOW_STATUS` (ttlMs, action, code, status), `CLEAR`, `PING` |
| Status | 16 bytes, preloaded for the next master read: `0xEA`, version, `fwVer` 1, `bootId` (random per boot), `seq` of the last frame handled, `state`, `err`, CRC |
| States | `IDLE` home screen; `DRAWING` while a screen is drawn; `SHOWN` once it is fully on the panel; `FAILED` with `DRAW_FAILED` when it could not be drawn (home screen shown) |
| Errors | A bad frame sets `err` (`BAD_CRC`, `BAD_LEN`, `BAD_VERSION`, `UNKNOWN_CMD`, `URI_TOO_LONG`), reports the frame's own `seq` when it has one, and keeps the state and the screen. A valid frame resets `err` to `NONE` |
| Repeats | A frame with the `seq` of the last valid frame is not drawn again; its status is preloaded again. A new `seq` supersedes. The mailbox holds one frame: the newest wins |
| Local clearing | Back to the home screen (`IDLE`) at boot, on `CLEAR`, when `ttlMs` has elapsed (counted with `millis()` from the reception of the frame, for a QR and for a status), and after 3 s without any write from the hub. `PING` keeps the node alive without a redraw |
| Secrets | The URI is in RAM only, never printed. The mailbox, the frame copy, the decoded command, the QR buffers and Wire's receive buffer are zeroed right after the draw, on every clear and after a bad frame. Serial shows `cmd`, `seq`, `state` and `err` only |
| QR | ECC L, version up to 9 (53 modules for the 218-character URI; the frame's 230-byte limit is exactly version 9-L). 4 px modules: 212 px, with a 2-module quiet zone of white screen, 228 px wide. Smaller codes get up to 7 px |

Layout: `src/cyd_state.h` is the link logic (mailbox, frame checks, state machine, status,
clearing) with no hardware and an injected clock; `display-node.ino` wires it to the TFT, `Wire`
and `Serial` through the `CydBoard` interface. `onReceive` (I2C task) only copies the write into
the mailbox; frames are checked and drawn in `loop()`.

What was checked in the arduino-esp32 3.3.12 source (`libraries/Wire/src/Wire.cpp`,
`cores/esp32/esp32-hal-i2c-slave.c`) for the classic ESP32:

- the slave cannot stretch SCL; `onRequest` runs in the core's `i2c_slave_task` after a master
  read has completed, so it only refills the FIFO for the next read. The status is therefore
  preloaded with `Wire.slaveWrite()` after every change and again from `onRequest`;
- `slaveWrite()` resets a non-empty TX FIFO before writing, so a preload replaces stale bytes; the
  16-byte status fits the 32-byte FIFO;
- `onReceive` also runs in that task. The core copies each write with a `uint8_t` index, so a
  256-byte write would never end: the buffer is set to 255 bytes (the largest frame), not 256;
- the core's own copies of a write (its RX ring buffer and a heap block freed by the I2C task) are
  not reachable from the sketch and are not wiped; later writes overwrite them.

## Build and test

Host tests of the link logic (C++17, `-Wall -Wextra -Werror`, AddressSanitizer and UBSan):

```bash
firmware/display-node/tests/host/run.sh
```

Once this branch and the hub branch are both merged, the two copies of the frame must match:

```bash
cmp firmware/locker-controller/src/display_frame.h firmware/display-node/src/display_frame.h
```

## Pins

From the LCDWiki E32R32P design: SPI SCLK 14, MISO 12, MOSI 13, CS 15, DC 2, backlight GPIO 27
(driven high). The bus runs at 40 MHz.

## Text and artwork

Text, logo, icons and the QR card are anti-aliased bitmaps compiled from `assets.h`. That file is
generated, not committed (it is ignored by `.gitignore`). It comes from
[Inter](https://fonts.google.com/specimen/Inter) (© The Inter Project Authors, SIL Open Font
License 1.1, <https://openfontlicense.org>) and from the Aegis Core mark in
`docs/design/identite/assets/aegis-core-mark.svg`.

Generate it once, from the repository root. It needs Python 3 with Pillow and the variable font
`Inter[opsz,wght].ttf` (for example from
`https://github.com/google/fonts/tree/main/ofl/inter`), kept outside the repository:

```bash
python3 firmware/display-node/tools/gen_assets.py <path to Inter[opsz,wght].ttf> firmware/display-node/assets.h
```

## Build and flash

Needs `arduino-cli` and the `esp32:esp32` core (3.3.12 was used), plus the libraries
`Adafruit GFX Library` and `Adafruit ST7735 and ST7789 Library`. The QR generator comes with the
ESP32 core. These boards need `UploadSpeed=115200` to flash reliably:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 --board-options UploadSpeed=115200 firmware/display-node
```

```bash
arduino-cli upload --fqbn esp32:esp32:esp32 --board-options UploadSpeed=115200 --port <serial port> firmware/display-node
```

The bench sketch used about 51 % of the program storage. The link sketch was compiled only with a
stub `assets.h` (blank artwork at the real sizes, one-glyph fonts): 433,328 bytes (33 %) and
28,748 bytes of globals; the real fonts add to that.

## Bench checklist

Bench run of 2026-11-25 (hub firmware 0.4.0 on staging, cell A1, this CYD) is recorded below.

- [x] The link on a real bus: a CYD reset while wired made the hub log `display node restarted`
  (valid status reads before and after, new `bootId`); no bus reset logged. `PING` cadence not measured.
- [ ] Preloading: the status the hub reads is the current one; how often a read is torn by a
  preload landing during it (the hub drops a bad CRC, 5 in a row reset its bus); whether `onRequest`
  fires after each read on this chip (stale FIFO bytes are harmless: the hub ignores a status whose
  `seq` is not the one it sent).
- [ ] Pull-ups: where the 4.7 kΩ resistors sit, and the signal at 100 kHz on the real cable.
- [x] The 218-character URI at 4 px (QR version 9) was read by the iPhone (2026-11-25).
- [x] Draw time of the QR screen is under the hub's 1 s draw timeout: two test challenges were
  answered `ACCESS_CHALLENGE_DISPLAYED`, none timed out. Not measured precisely.
- [x] The real `assets.h` (generated from Inter): 44 % of flash. Home and QR screens seen on the panel.
- [x] `bootId` changed across a reset (seen by the hub). `esp_random()` without Wi-Fi or Bluetooth
  stays only pseudo-random.
- [ ] A dead or disconnected panel is not detected: the ST7789 is not read back, so `SHOWN` means
  the draw calls returned.
