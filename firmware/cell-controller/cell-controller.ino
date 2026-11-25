// Aegis cell firmware (FW-00, FW-01, FW-02): answers each PING of the hub on its RS-485 segment with
// its cell address, a boot id, its reset reason, the state of its latch and the health of its UHF
// reader; on the hub's SCAN it reads tags for a 3 s window and hands them over one TAG at a time
// (frame in firmware/locker-controller/README.md). It never fires the lock yet (#42). The cell has
// no network identity and decides nothing: the backend judges presence (ADR-001, ADR-002).

#include <Arduino.h>
#include <esp_system.h>

#include "src/cell_frame.h"
#include "src/cell_state.h"

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

// UHF unit as on the POC-01 bench (#19): the unit's TX on GPIO 13, its RX on GPIO 14.
constexpr int UHF_RX_PIN = 13;
constexpr int UHF_TX_PIN = 14;
constexpr uint32_t UHF_BAUD = 115200;

// Lock as on the POC-03 bench (#21): MOSFET module TRIG on GPIO 25 (10 kOhm to GND), latch switch
// white wire on GPIO 27, yellow on GND.
constexpr int LOCK_GATE_PIN = 25;
constexpr int LATCH_SWITCH_PIN = 27;

static aegis::cellframe::LineReader linkReader;
static aegis::cell::UhfFrameReader uhfReader;
static aegis::cell::ReaderHealth reader;
static aegis::cell::LatchSwitch latch;
static aegis::cell::ScanWindow scan;
static uint32_t bootId;
static uint8_t resetCode;
static char reportedLock = '\0';
static char reportedReader = '\0';

// Pin level that means "contact closed" (striker out, UNLOCKED). The POC-03 L0 bench unit read LOW;
// the lab unit wired on 2026-11-25 reads the other way round. HIGH also makes an unwired or cut switch
// read UNLOCKED instead of a false LOCKED.
constexpr int LATCH_CLOSED_LEVEL = HIGH;
static bool contactClosed() { return digitalRead(LATCH_SWITCH_PIN) == LATCH_CLOSED_LEVEL; }

static void answerHub() {
  while (Serial2.available() > 0) {
    if (!linkReader.push(static_cast<char>(Serial2.read()))) continue;
    if (linkReader.overflowed) {
      linkReader.clearOverflow();
      continue;
    }
    // Corrupted frames, and our own replies echoed back, are dropped without an answer.
    if (!aegis::cellframe::unseal(linkReader.buf)) continue;
    uint32_t seq;
    uint8_t index;
    char frame[aegis::cellframe::MAX_LINE];
    size_t n = 0;
    if (aegis::cellframe::parseTagRequest(linkReader.buf, &seq, &index)) {
      const aegis::cellframe::Tag* tag = scan.tag(index);
      if (tag == nullptr) continue;  // no such tag: the hub times out and asks again
      n = aegis::cellframe::encodeTag(seq, static_cast<uint8_t>(CELL_ADDRESS), index, *tag, frame, sizeof(frame));
    } else {
      bool isScan = aegis::cellframe::parseScan(linkReader.buf, &seq);
      if (!isScan && !aegis::cellframe::parsePing(linkReader.buf, &seq)) continue;
      // A SCAN while a window runs keeps that window: the hub re-sends SCAN until it sees one running.
      if (isScan && scan.state() != aegis::cellframe::SCAN_RUNNING) {
        scan.start(millis());
        Serial.printf("cell %d: scan window started\n", CELL_ADDRESS);
      }
      aegis::cellframe::Reply reply{seq,           static_cast<uint8_t>(CELL_ADDRESS), bootId, resetCode,
                                    latch.state(), reader.status(),                     scan.state(),
                                    scan.tagCount(), scan.reader()};
      n = aegis::cellframe::encodeReply(reply, frame, sizeof(frame));
    }
    delay(REPLY_DELAY_MS);
    Serial2.write(reinterpret_cast<const uint8_t*>(frame), n);
  }
}

static void watchReader(uint32_t now) {
  while (Serial1.available() > 0) {
    if (!uhfReader.push(static_cast<uint8_t>(Serial1.read()))) continue;
    reader.onValidFrame();
    scan.onValidFrame();
    const uint8_t* epc;
    size_t len;
    if (aegis::cell::tagEpc(uhfReader, &epc, &len)) scan.onTag(epc, len);
  }
  const char before = scan.state();
  // While a window runs it owns the reader's polls (every 100 ms); otherwise one per second.
  bool poll = before == aegis::cellframe::SCAN_RUNNING ? scan.pollDue(now) : reader.pollDue(now);
  if (poll) Serial1.write(aegis::cell::UHF_SINGLE_POLL, sizeof(aegis::cell::UHF_SINGLE_POLL));
  if (before == aegis::cellframe::SCAN_RUNNING && scan.state() == aegis::cellframe::SCAN_DONE) {
    Serial.printf("cell %d: scan done, reader %s, %u tag(s)\n", CELL_ADDRESS,
                  aegis::cellframe::readerStatusName(scan.reader()), scan.tagCount());
    for (uint8_t i = 0; i < scan.tagCount(); i++) {
      Serial.printf("  %s x%u\n", scan.tag(i)->epc, scan.tag(i)->readCount);
    }
  }
}

static void logChanges() {
  if (latch.state() == reportedLock && reader.status() == reportedReader) return;
  reportedLock = latch.state();
  reportedReader = reader.status();
  Serial.printf("cell %d: lock %s, reader %s\n", CELL_ADDRESS, aegis::cellframe::lockStateName(reportedLock),
                aegis::cellframe::readerStatusName(reportedReader));
}

void setup() {
  // Level first, then direction: a reboot never pulses the lock (doc 12 §8).
  digitalWrite(LOCK_GATE_PIN, LOW);
  pinMode(LOCK_GATE_PIN, OUTPUT);
  pinMode(LATCH_SWITCH_PIN, INPUT_PULLUP);

  Serial.begin(115200);
  Serial2.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
  Serial1.begin(UHF_BAUD, SERIAL_8N1, UHF_RX_PIN, UHF_TX_PIN);
  bootId = esp_random();
  resetCode = static_cast<uint8_t>(esp_reset_reason());
  delay(5);
  latch.begin(contactClosed());
  Serial.printf("cell %d ready, bootId=%08lX, reset code %u\n", CELL_ADDRESS, static_cast<unsigned long>(bootId),
                resetCode);
}

void loop() {
  const uint32_t now = millis();
  answerHub();
  latch.sample(contactClosed(), now);
  watchReader(now);
  logChanges();
}
