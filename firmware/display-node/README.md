# Display node firmware (FW-04, issue #45; POC-04, issue #22)

Bench firmware of the hub screen: a Freenove ESP32 Display 3.2" (FNK0103, LCDWiki E32R32P,
ST7789 240 × 320). It is the display node of
[ADR-016](../../docs/adr/ADR-016-ecran-hub-noeud-cyd-i2c.md) (proposed): no Wi-Fi, no MQTT
and no network identity, it decides nothing.

In this slice it is a **visual bench**, not yet the node behind the hub:

- it loops the screens of the hub display contract (doc 10 §27): the Aegis home screen, the
  QR challenge with its 60 s countdown, and the four result screens `CONFIRMED`,
  `EXPIRED`, `FAILED` and `ANOMALY` (French text, as the contract's predefined messages);
- the QR holds the fixed test text `AEGIS-POC04-TEST`: it carries no opening power and no
  token, and the screens show the action and the compartment code, never a person's name
  (doc 10 §27.1);
- the module size is 7 px, the size retained after the POC-04 bench test with the iPhone.

Not done yet: the I2C link to the hub and its frame, the draw acknowledgement the hub needs
before it publishes `ACCESS_CHALLENGE_DISPLAYED` (doc 10 §27.2), and local clearing on expiry.

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

The sketch uses about 51 % of the program storage of the board.
