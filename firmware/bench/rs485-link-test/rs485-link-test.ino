// POC-02 bench test (issue #20): one RS-485 link between two ESP32-WROVER boards
// over Cat6. The same sketch runs on both boards; the role picks the behaviour.
//
// Hub:  sends PING frames, waits for the matching reply, prints link statistics
//       and presence changes on the USB serial monitor.
// Cell: answers each valid PING with its sequence, boot id and reset reason.
//
// Frame format (ASCII, one line):  <body>,<CRC16-CCITT of body as 4 hex>\n
//   PING  : P,<seq 8 hex>
//   REPLY : R,<seq 8 hex>,<bootId 8 hex>,<resetReason 2 hex>

#include <Arduino.h>
#include <esp_system.h>

// Pick the board's role: ROLE_HUB for the hub board, ROLE_CELL for the cell board.
#if !defined(ROLE_HUB) && !defined(ROLE_CELL)
#define ROLE_HUB
#endif

#if defined(ROLE_HUB) == defined(ROLE_CELL)
#error "Define exactly one role at the top of the sketch: ROLE_HUB or ROLE_CELL"
#endif

#ifndef LINK_BAUD
#define LINK_BAUD 115200  // both boards must match; 115200 passed T3, 9600 is the fallback
#endif

// On the Freenove WROVER camera board, GPIO 16/17 belong to PSRAM and
// 21/22/26/27 to the camera, so the link UART uses 32/33.
constexpr int LINK_RX_PIN = 32;
constexpr int LINK_TX_PIN = 33;
constexpr int STATUS_LED_PIN = 2;  // set to -1 if your board has no LED on GPIO 2
constexpr uint32_t USB_BAUD = 115200;

constexpr size_t MAX_LINE = 48;
constexpr size_t MAX_REPLY_BYTES = 28;
// Gives the auto-direction transceiver on the hub time to fall back to receive.
constexpr uint32_t REPLY_DELAY_MS = 2;

constexpr uint32_t FRAME_GAP_MS = 20;
constexpr uint32_t TEST_FRAMES = 10000;
constexpr uint32_t REPORT_EVERY = 1000;
constexpr uint32_t ABSENT_AFTER_MISSES = 3;

HardwareSerial rs485(2);

// Declared before any function: the Arduino IDE inserts prototypes above the
// first function, so types used in signatures must already exist there.
enum class Outcome { Ok, Timeout, CrcError, BadFrame };

struct Reply {
  uint32_t bootId;
  uint32_t resetReason;
  uint32_t latencyUs;
};

// ---------------------------------------------------------------- framing

uint16_t crc16(const char* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= static_cast<uint16_t>(static_cast<uint8_t>(data[i])) << 8;
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021) : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

bool parseHex(const char* s, size_t digits, uint32_t* out) {
  uint32_t value = 0;
  for (size_t i = 0; i < digits; i++) {
    char c = s[i];
    uint32_t nibble;
    if (c >= '0' && c <= '9') nibble = c - '0';
    else if (c >= 'A' && c <= 'F') nibble = c - 'A' + 10;
    else return false;
    value = (value << 4) | nibble;
  }
  *out = value;
  return true;
}

void sendFrame(const char* body) {
  char frame[MAX_LINE];
  int n = snprintf(frame, sizeof(frame), "%s,%04X\n", body, crc16(body, strlen(body)));
  rs485.write(reinterpret_cast<const uint8_t*>(frame), n);
  rs485.flush();
}

// Verifies and strips the trailing CRC field in place.
bool checkFrame(char* line) {
  char* comma = strrchr(line, ',');
  if (comma == nullptr || strlen(comma + 1) != 4) return false;
  uint32_t expected;
  if (!parseHex(comma + 1, 4, &expected)) return false;
  if (crc16(line, comma - line) != expected) return false;
  *comma = '\0';
  return true;
}

struct LineReader {
  char buf[MAX_LINE];
  size_t len = 0;
  bool overflowed = false;

  void reset() {
    len = 0;
    overflowed = false;
  }

  // Returns true when a complete line is in buf. An oversized line is
  // reported once with overflowed set and an empty buf.
  bool poll(Stream& in) {
    while (in.available()) {
      char c = static_cast<char>(in.read());
      if (c == '\r') continue;
      if (c == '\n') {
        buf[overflowed ? 0 : len] = '\0';
        len = 0;
        return true;
      }
      if (len < MAX_LINE - 1) {
        buf[len++] = c;
      } else {
        overflowed = true;
      }
    }
    return false;
  }
};

LineReader reader;

void setLed(bool on) {
  if (STATUS_LED_PIN >= 0) digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}

const char* resetReasonName(uint32_t reason) {
  switch (static_cast<esp_reset_reason_t>(reason)) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXTERNAL_PIN";
    case ESP_RST_SW: return "SOFTWARE";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

// ---------------------------------------------------------------- cell

#ifdef ROLE_CELL

uint32_t bootId;
uint8_t resetReason;
bool ledOn = false;

void setupRole() {
  bootId = esp_random();
  resetReason = static_cast<uint8_t>(esp_reset_reason());
  Serial.printf("CELL ready, bootId=%08lX, reset=%s\n", static_cast<unsigned long>(bootId),
                resetReasonName(resetReason));
}

void loopRole() {
  if (!reader.poll(rs485)) return;

  if (reader.overflowed) {
    reader.reset();
    Serial.println("[cell] oversized frame dropped");
    return;
  }
  if (!checkFrame(reader.buf)) {
    Serial.println("[cell] CRC error, frame dropped");
    return;
  }

  uint32_t seq;
  if (strlen(reader.buf) != 10 || reader.buf[0] != 'P' || reader.buf[1] != ',' ||
      !parseHex(reader.buf + 2, 8, &seq)) {
    return;  // not a PING (for example our own reply echoed back)
  }

  delay(REPLY_DELAY_MS);
  char body[MAX_LINE];
  snprintf(body, sizeof(body), "R,%08lX,%08lX,%02X", static_cast<unsigned long>(seq),
           static_cast<unsigned long>(bootId), resetReason);
  sendFrame(body);

  ledOn = !ledOn;
  setLed(ledOn);
}

#endif

// ---------------------------------------------------------------- hub

#ifdef ROLE_HUB

struct Stats {
  uint32_t sent = 0;
  uint32_t ok = 0;
  uint32_t timeouts = 0;
  uint32_t crcErrors = 0;
  uint32_t badFrames = 0;
  uint32_t staleReplies = 0;
  uint32_t echoes = 0;
  uint32_t lateBytes = 0;
  uint64_t latencySumUs = 0;
  uint32_t latencyMaxUs = 0;
  uint32_t absentEvents = 0;
  uint32_t reboots = 0;
};

Stats stats;
uint32_t seq = 0;
uint32_t timeoutUs;
bool resultPrinted = false;

bool cellPresent = false;
bool bootKnown = false;
uint32_t lastBootId = 0;
uint32_t consecutiveMisses = 0;
uint32_t lastOkMs = 0;
uint32_t absentSinceMs = 0;

void printStats(const char* label) {
  uint32_t avg = stats.ok ? static_cast<uint32_t>(stats.latencySumUs / stats.ok) : 0;
  Serial.printf(
      "[%s] baud=%d sent=%lu ok=%lu timeout=%lu crc=%lu bad=%lu stale=%lu echo=%lu lateBytes=%lu "
      "latency avg=%.2fms max=%.2fms absentEvents=%lu reboots=%lu cell=%s\n",
      label, LINK_BAUD, static_cast<unsigned long>(stats.sent), static_cast<unsigned long>(stats.ok),
      static_cast<unsigned long>(stats.timeouts), static_cast<unsigned long>(stats.crcErrors),
      static_cast<unsigned long>(stats.badFrames), static_cast<unsigned long>(stats.staleReplies),
      static_cast<unsigned long>(stats.echoes), static_cast<unsigned long>(stats.lateBytes), avg / 1000.0,
      stats.latencyMaxUs / 1000.0, static_cast<unsigned long>(stats.absentEvents),
      static_cast<unsigned long>(stats.reboots), cellPresent ? "PRESENT" : "ABSENT");
}

void resetStats() {
  stats = Stats();
  resultPrinted = false;
  Serial.println("[hub] statistics reset, starting a new run");
}

void handleUsbCommands() {
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == 'r') resetStats();
    if (c == 's') printStats("stats");
  }
}

Outcome waitReply(uint32_t expectedSeq, uint32_t startUs, Reply* reply) {
  while (micros() - startUs < timeoutUs) {
    if (!reader.poll(rs485)) continue;

    if (reader.overflowed) {
      reader.reset();
      return Outcome::BadFrame;
    }
    if (!checkFrame(reader.buf)) return Outcome::CrcError;

    const char* b = reader.buf;
    if (b[0] == 'P') {
      stats.echoes++;  // our own PING read back by the transceiver
      continue;
    }

    uint32_t replySeq;
    if (strlen(b) != 22 || b[0] != 'R' || b[1] != ',' || b[10] != ',' || b[19] != ',' ||
        !parseHex(b + 2, 8, &replySeq) || !parseHex(b + 11, 8, &reply->bootId) ||
        !parseHex(b + 20, 2, &reply->resetReason)) {
      return Outcome::BadFrame;
    }
    if (replySeq != expectedSeq) {
      stats.staleReplies++;  // a late answer to an earlier PING; never counted as success
      continue;
    }
    reply->latencyUs = micros() - startUs;
    return Outcome::Ok;
  }
  return Outcome::Timeout;
}

void updatePresence(Outcome outcome, const Reply& reply) {
  uint32_t now = millis();

  if (outcome == Outcome::Ok) {
    consecutiveMisses = 0;
    if (!cellPresent) {
      cellPresent = true;
      if (stats.absentEvents == 0 && !bootKnown) {
        Serial.println("[T4] cell PRESENT (first contact)");
      } else {
        Serial.printf("[T4] cell PRESENT again, %lu ms after being flagged absent\n",
                      static_cast<unsigned long>(now - absentSinceMs));
      }
    }
    if (!bootKnown || reply.bootId != lastBootId) {
      if (bootKnown) stats.reboots++;
      Serial.printf("[T4] cell %s, bootId=%08lX, reset reason=%s\n", bootKnown ? "REBOOTED" : "boot seen",
                    static_cast<unsigned long>(reply.bootId), resetReasonName(reply.resetReason));
      bootKnown = true;
      lastBootId = reply.bootId;
    }
    lastOkMs = now;
    setLed(true);
    return;
  }

  consecutiveMisses++;
  if (cellPresent && consecutiveMisses >= ABSENT_AFTER_MISSES) {
    cellPresent = false;
    absentSinceMs = now;
    stats.absentEvents++;
    Serial.printf("[T4] cell ABSENT: %lu missed replies, %lu ms since the last valid reply\n",
                  static_cast<unsigned long>(consecutiveMisses), static_cast<unsigned long>(now - lastOkMs));
    setLed(false);
  }
}

void setupRole() {
  uint32_t replyUs = static_cast<uint32_t>(MAX_REPLY_BYTES * 10ULL * 1000000ULL / LINK_BAUD);
  timeoutUs = 2 * replyUs + REPLY_DELAY_MS * 1000 + 20000;
  Serial.printf("HUB ready, baud=%d, reply timeout=%.1fms, %lu frames per run\n", LINK_BAUD,
                timeoutUs / 1000.0, static_cast<unsigned long>(TEST_FRAMES));
  Serial.println("Commands: 's' print stats, 'r' reset stats and start a new run");
}

void loopRole() {
  handleUsbCommands();

  while (rs485.available()) {
    rs485.read();
    stats.lateBytes++;
  }
  reader.reset();

  seq++;
  char body[MAX_LINE];
  snprintf(body, sizeof(body), "P,%08lX", static_cast<unsigned long>(seq));
  sendFrame(body);
  uint32_t startUs = micros();
  stats.sent++;

  Reply reply{};
  Outcome outcome = waitReply(seq, startUs, &reply);
  switch (outcome) {
    case Outcome::Ok:
      stats.ok++;
      stats.latencySumUs += reply.latencyUs;
      if (reply.latencyUs > stats.latencyMaxUs) stats.latencyMaxUs = reply.latencyUs;
      break;
    case Outcome::Timeout: stats.timeouts++; break;
    case Outcome::CrcError: stats.crcErrors++; break;
    case Outcome::BadFrame: stats.badFrames++; break;
  }
  updatePresence(outcome, reply);

  if (stats.sent % REPORT_EVERY == 0) printStats("stats");
  if (stats.sent == TEST_FRAMES && !resultPrinted) {
    resultPrinted = true;
    printStats("T3 RESULT");
    Serial.printf("[T3 RESULT] %s (lost or rejected: %lu of %lu)\n",
                  stats.ok == stats.sent ? "no loss" : "LOSSES, investigate",
                  static_cast<unsigned long>(stats.sent - stats.ok), static_cast<unsigned long>(stats.sent));
    Serial.println("[hub] continuing as soak test (T5); press 'r' to start a new run");
  }

  delay(FRAME_GAP_MS);
}

#endif

// ---------------------------------------------------------------- common

void setup() {
  Serial.begin(USB_BAUD);
  if (STATUS_LED_PIN >= 0) {
    pinMode(STATUS_LED_PIN, OUTPUT);
    setLed(false);
  }
  rs485.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
  delay(200);
  setupRole();
}

void loop() {
  loopRole();
}
