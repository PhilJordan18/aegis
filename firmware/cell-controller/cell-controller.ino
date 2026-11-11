// Aegis cell firmware (FW-00): answers each PING of the hub on its RS-485 segment with its cell
// address, a boot id and its reset reason (frame in firmware/locker-controller/README.md). No
// lock, door or RFID yet: those arrive with #42, #30 and #32. The cell has no network identity
// and decides nothing (ADR-001, ADR-002).

#include <Arduino.h>
#include <esp_system.h>

#include "src/cell_frame.h"

// 1 for A1, 2 for A2: flash each cell with its own address and set it back to 1 before committing.
// The hub reports a cell that answers with another address as DISCONNECTED, so a swapped cable
// never makes A2's state appear as A1's.
#ifndef CELL_ADDRESS
#define CELL_ADDRESS 1
#endif
static_assert(CELL_ADDRESS >= 1 && CELL_ADDRESS <= 255, "CELL_ADDRESS must fit the frame's 2 hex digits");

// Same wiring as the POC-02 bench (issue #20): transceiver TXD -> GPIO 32, RXD -> GPIO 33.
constexpr int LINK_RX_PIN = 32;
constexpr int LINK_TX_PIN = 33;
constexpr uint32_t LINK_BAUD = 115200;  // must match the hub
// Gives the hub's auto-direction transceiver time to fall back to receive after its PING.
constexpr uint32_t REPLY_DELAY_MS = 2;

static aegis::cellframe::LineReader reader;
static uint32_t bootId;
static uint8_t resetCode;

void setup() {
  Serial.begin(115200);
  Serial2.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
  bootId = esp_random();
  resetCode = static_cast<uint8_t>(esp_reset_reason());
  Serial.printf("cell %d ready, bootId=%08lX, reset code %u\n", CELL_ADDRESS, static_cast<unsigned long>(bootId),
                resetCode);
}

void loop() {
  while (Serial2.available() > 0) {
    if (!reader.push(static_cast<char>(Serial2.read()))) continue;
    if (reader.overflowed) {
      reader.clearOverflow();
      continue;
    }
    uint32_t seq;
    // Corrupted frames, and our own replies echoed back, are dropped without an answer.
    if (!aegis::cellframe::unseal(reader.buf) || !aegis::cellframe::parsePing(reader.buf, &seq)) continue;

    delay(REPLY_DELAY_MS);
    char frame[aegis::cellframe::MAX_LINE];
    aegis::cellframe::Reply reply{seq, static_cast<uint8_t>(CELL_ADDRESS), bootId, resetCode};
    size_t n = aegis::cellframe::encodeReply(reply, frame, sizeof(frame));
    Serial2.write(reinterpret_cast<const uint8_t*>(frame), n);
  }
}
