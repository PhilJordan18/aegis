// Bench test: hub <-> cell RS-485 link (POC-02) carrying UHF RFID scan results.
// Merges rs485-link-test and uhf-rfid-test. The same sketch runs on both boards;
// the role and UHF_ATTACHED pick the behaviour.
//
// Cell: runs UHF scan windows on the M5Stack UHF RFID Unit (when UHF_ATTACHED) and
//       answers each valid PING with its boot id plus the last completed scan window.
// Hub:  sends PING frames, prints link statistics and presence changes, and prints
//       each new scan window reported by the cell. With UHF_ATTACHED it also scans
//       locally, so the reader can be tested on either board.
//
// Frame format (ASCII, one line):  <body>,<CRC16-CCITT of body as 4 hex>\n
//   PING  : P,<seq 8 hex>
//   REPLY : R,<seq 8 hex>,<bootId 8 hex>,<resetReason 2 hex>,<window 4 hex>,<status H|U|N>,
//           <tags 2 hex>,<first EPC hex or ->,<first EPC reads 4 hex>
//   status: H reader healthy, U reader silent, N no reader attached to this cell
//   shortcut: a reply reports only the first tag of the window, extend to several tags
//             when a test needs more than one.

#include <Arduino.h>
#include <esp_system.h>

// Pick the board's role: ROLE_HUB for the hub board, ROLE_CELL for the cell board.
#if !defined(ROLE_HUB) && !defined(ROLE_CELL)
#define ROLE_HUB
#endif

#if defined(ROLE_HUB) == defined(ROLE_CELL)
#error "Define exactly one role at the top of the sketch: ROLE_HUB or ROLE_CELL"
#endif

// Define on the board that has the M5Stack UHF unit wired (usually the cell).
// #define UHF_ATTACHED

#ifndef LINK_BAUD
#define LINK_BAUD 115200  // both boards must match; 115200 passed T3, 9600 is the fallback
#endif

// RS-485 link UART: GPIO 16/17 belong to PSRAM and 21/22/26/27 to the camera on the
// Freenove WROVER board, so the link uses 32/33.
constexpr int LINK_RX_PIN = 32;
constexpr int LINK_TX_PIN = 33;
// UHF unit UART: ESP32 RX <- unit TX, ESP32 TX -> unit RX. Not 0/1/2/3/12/15 (boot, USB).
constexpr int UHF_RX_PIN = 13;
constexpr int UHF_TX_PIN = 14;
constexpr int STATUS_LED_PIN = 2;  // set to -1 if your board has no LED on GPIO 2
constexpr uint32_t USB_BAUD = 115200;
constexpr uint32_t UHF_BAUD = 115200;

constexpr size_t MAX_LINE = 128;
constexpr size_t MAX_REPLY_BYTES = 112;
// Gives the auto-direction transceiver on the hub time to fall back to receive.
constexpr uint32_t REPLY_DELAY_MS = 2;

constexpr uint32_t FRAME_GAP_MS = 20;
constexpr uint32_t TEST_FRAMES = 10000;
constexpr uint32_t REPORT_EVERY = 1000;
constexpr uint32_t ABSENT_AFTER_MISSES = 3;

constexpr uint32_t SCAN_WINDOW_MS = 3000;  // doc 10 caps a scan window at 10 s
constexpr uint32_t UHF_POLL_GAP_MS = 100;
constexpr size_t MAX_TAGS = 32;
constexpr size_t MAX_EPC_BYTES = 32;
constexpr size_t UHF_MAX_FRAME = 64;
constexpr bool DUMP_UHF_FRAMES = true;
// Set-power command (B6), in 0.01 dBm. 2000 = 20 dBm = 100 mW, the unit's stated maximum.
constexpr uint16_t TX_POWER_CENTI_DBM = 2000;

HardwareSerial rs485(2);

// Declared before any function: the Arduino IDE inserts prototypes above the
// first function, so types used in signatures must already exist there.
enum class Outcome { Ok, Timeout, CrcError, BadFrame };

struct ScanResult {
  uint16_t windowId;
  char status;  // H healthy, U silent, N no reader attached
  uint8_t tagCount;
  char epc[MAX_EPC_BYTES * 2 + 1];
  uint16_t reads;
};

struct Reply {
  uint32_t bootId;
  uint32_t resetReason;
  uint32_t latencyUs;
  ScanResult scan;
};

struct Tag {
  char epc[MAX_EPC_BYTES * 2 + 1];
  uint16_t reads;
};

ScanResult lastScan = {0, 'N', 0, "-", 0};

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

// ---------------------------------------------------------------- UHF reader

#ifdef UHF_ATTACHED

// UHF frame: BB <type> <cmd> <len hi> <len lo> <params> <checksum> 7E, where the
// checksum is the low byte of the sum of the bytes between BB and itself.
//   Single poll  : BB 00 22 00 00 22 7E
//   Tag reply    : BB 02 22 <len> <rssi> <PC 2> <EPC> <CRC 2> <checksum> 7E
//   Error/no tag : BB 01 FF 00 01 <code> <checksum> 7E   (code 15 = no tag)

HardwareSerial uhf(1);
Tag tags[MAX_TAGS];
size_t tagCount = 0;
bool sawValidFrame = false;  // distinguishes "no tag" from "reader silent"
uint32_t windowStartMs = 0;
uint32_t lastUhfPollMs = 0;

size_t buildUhfFrame(uint8_t* f, uint8_t cmd, const uint8_t* params, uint16_t plen) {
  size_t n = 0;
  f[n++] = 0xBB;
  f[n++] = 0x00;
  f[n++] = cmd;
  f[n++] = plen >> 8;
  f[n++] = plen & 0xFF;
  for (uint16_t i = 0; i < plen; i++) f[n++] = params[i];
  uint8_t sum = 0;
  for (size_t i = 1; i < n; i++) sum += f[i];
  f[n++] = sum;
  f[n++] = 0x7E;
  return n;
}

void sendUhfCommand(uint8_t cmd, const uint8_t* params, uint16_t plen) {
  uint8_t f[UHF_MAX_FRAME];
  size_t n = buildUhfFrame(f, cmd, params, plen);
  uhf.write(f, n);
}

struct UhfFrameReader {
  uint8_t buf[UHF_MAX_FRAME];
  size_t len = 0;
  size_t frameLen = 0;

  // Returns true when a complete frame (by its declared length) is in buf.
  bool poll(Stream& in) {
    while (in.available()) {
      uint8_t b = static_cast<uint8_t>(in.read());
      if (len == 0 && b != 0xBB) continue;
      buf[len++] = b;
      if (len < 5) continue;
      size_t total = 7 + ((static_cast<size_t>(buf[3]) << 8) | buf[4]);
      if (total > UHF_MAX_FRAME) {
        len = 0;
        continue;
      }
      if (len == total) {
        frameLen = len;
        len = 0;
        return true;
      }
    }
    return false;
  }
};

UhfFrameReader uhfReader;

void addRead(const uint8_t* epc, size_t len) {
  char hex[MAX_EPC_BYTES * 2 + 1];
  if (len > MAX_EPC_BYTES) len = MAX_EPC_BYTES;
  for (size_t i = 0; i < len; i++) snprintf(hex + i * 2, 3, "%02X", epc[i]);
  hex[len * 2] = '\0';

  for (size_t i = 0; i < tagCount; i++) {
    if (strcmp(tags[i].epc, hex) == 0) {
      if (tags[i].reads < 65535) tags[i].reads++;
      return;
    }
  }
  if (tagCount == MAX_TAGS) return;
  strcpy(tags[tagCount].epc, hex);
  tags[tagCount].reads = 1;
  tagCount++;
}

void handleUhfFrame(const uint8_t* f, size_t n) {
  bool noTag = n == 8 && f[1] == 0x01 && f[2] == 0xFF && f[5] == 0x15;  // routine reply, not worth printing
  if (DUMP_UHF_FRAMES && !noTag) {
    Serial.print("[uhf rx] ");
    for (size_t i = 0; i < n; i++) Serial.printf("%02X ", f[i]);
    Serial.println();
  }
  uint8_t sum = 0;
  for (size_t i = 1; i < n - 2; i++) sum += f[i];
  if (f[n - 1] != 0x7E || f[n - 2] != sum) {
    Serial.println("[uhf] bad end byte or checksum, frame dropped");
    return;
  }
  sawValidFrame = true;

  uint8_t type = f[1];
  uint8_t cmd = f[2];
  uint16_t plen = (static_cast<uint16_t>(f[3]) << 8) | f[4];
  const uint8_t* p = f + 5;

  if (type == 0x02 && cmd == 0x22 && plen >= 5) {
    addRead(p + 3, plen - 5);  // skip RSSI (1) and PC (2); drop the trailing CRC (2)
  } else if (type == 0x01 && cmd == 0xFF && plen >= 1) {
    if (p[0] != 0x15) Serial.printf("[uhf] reader error code 0x%02X\n", p[0]);  // 0x15 = no tag
  }
}

void endScanWindow() {
  lastScan.windowId++;
  lastScan.status = sawValidFrame ? 'H' : 'U';
  lastScan.tagCount = static_cast<uint8_t>(tagCount);
  if (tagCount > 0) {
    strcpy(lastScan.epc, tags[0].epc);
    lastScan.reads = tags[0].reads;
  } else {
    strcpy(lastScan.epc, "-");
    lastScan.reads = 0;
  }

  Serial.printf("[uhf scan] window=%u readerStatus=%s tags=%u\n", lastScan.windowId,
                sawValidFrame ? "HEALTHY" : "UNKNOWN", static_cast<unsigned>(tagCount));
  for (size_t i = 0; i < tagCount; i++) {
    Serial.printf("  RFID_UHF epc=%s readCount=%u\n", tags[i].epc, tags[i].reads);
  }
  if (!sawValidFrame) Serial.println("  no valid frame from the reader: check wiring, power, baud");
  tagCount = 0;
  sawValidFrame = false;
}

// Checks the builder against the single-poll frame documented by M5Stack.
bool uhfSelfCheck() {
  const uint8_t expected[] = {0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E};
  uint8_t f[UHF_MAX_FRAME];
  size_t n = buildUhfFrame(f, 0x22, nullptr, 0);
  return n == sizeof(expected) && memcmp(f, expected, n) == 0;
}

void setupUhf() {
  uhf.begin(UHF_BAUD, SERIAL_8N1, UHF_RX_PIN, UHF_TX_PIN);
  Serial.printf("UHF reader on rx=%d tx=%d, self-check %s\n", UHF_RX_PIN, UHF_TX_PIN,
                uhfSelfCheck() ? "OK" : "FAILED");

  // Get hardware version (param 0x00): the reply proves the link before any tag is read.
  const uint8_t versionParam[] = {0x00};
  sendUhfCommand(0x03, versionParam, 1);
  delay(100);

  const uint8_t powerParams[] = {static_cast<uint8_t>(TX_POWER_CENTI_DBM >> 8),
                                 static_cast<uint8_t>(TX_POWER_CENTI_DBM & 0xFF)};
  sendUhfCommand(0xB6, powerParams, 2);
  windowStartMs = millis();
  lastScan.status = 'U';
}

void loopUhf() {
  uint32_t now = millis();

  if (now - lastUhfPollMs >= UHF_POLL_GAP_MS) {
    lastUhfPollMs = now;
    sendUhfCommand(0x22, nullptr, 0);
  }

  while (uhfReader.poll(uhf)) handleUhfFrame(uhfReader.buf, uhfReader.frameLen);

  if (now - windowStartMs >= SCAN_WINDOW_MS) {
    windowStartMs = now;
    endScanWindow();
  }
}

#endif

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
  snprintf(body, sizeof(body), "R,%08lX,%08lX,%02X,%04X,%c,%02X,%s,%04X", static_cast<unsigned long>(seq),
           static_cast<unsigned long>(bootId), resetReason, lastScan.windowId, lastScan.status,
           lastScan.tagCount, lastScan.epc, lastScan.reads);
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
uint16_t lastWindowShown = 0xFFFF;

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

// Parses "R,<seq>,<boot>,<reset>,<window>,<status>,<tags>,<epc>,<reads>" after the CRC is stripped.
bool parseReply(const char* b, uint32_t* replySeq, Reply* reply) {
  if (strlen(b) < 36 || b[0] != 'R' || b[1] != ',' || b[10] != ',' || b[19] != ',' || b[22] != ',' ||
      b[27] != ',' || b[29] != ',' || b[32] != ',') {
    return false;
  }
  uint32_t window, tagCount, reads;
  if (!parseHex(b + 2, 8, replySeq) || !parseHex(b + 11, 8, &reply->bootId) ||
      !parseHex(b + 20, 2, &reply->resetReason) || !parseHex(b + 23, 4, &window) ||
      !parseHex(b + 30, 2, &tagCount)) {
    return false;
  }
  const char* epc = b + 33;
  const char* lastComma = strrchr(b, ',');
  if (lastComma <= epc || strlen(lastComma + 1) != 4 || !parseHex(lastComma + 1, 4, &reads)) return false;
  size_t epcLen = lastComma - epc;
  if (epcLen > MAX_EPC_BYTES * 2) return false;

  reply->scan.windowId = static_cast<uint16_t>(window);
  reply->scan.status = b[28];
  reply->scan.tagCount = static_cast<uint8_t>(tagCount);
  memcpy(reply->scan.epc, epc, epcLen);
  reply->scan.epc[epcLen] = '\0';
  reply->scan.reads = static_cast<uint16_t>(reads);
  return true;
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
    if (!parseReply(b, &replySeq, reply)) return Outcome::BadFrame;
    if (replySeq != expectedSeq) {
      stats.staleReplies++;  // a late answer to an earlier PING; never counted as success
      continue;
    }
    reply->latencyUs = micros() - startUs;
    return Outcome::Ok;
  }
  return Outcome::Timeout;
}

void reportScan(const ScanResult& s) {
  if (s.windowId == lastWindowShown) return;
  lastWindowShown = s.windowId;
  if (s.status == 'N') {
    Serial.println("[scan] cell has no UHF reader attached");
    return;
  }
  Serial.printf("[scan] cell window=%u readerStatus=%s tags=%u firstEpc=%s reads=%u\n", s.windowId,
                s.status == 'H' ? "HEALTHY" : "UNKNOWN", s.tagCount, s.epc, s.reads);
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
      reportScan(reply.scan);
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
#ifdef UHF_ATTACHED
  setupUhf();
#endif
}

void loop() {
  loopRole();
#ifdef UHF_ATTACHED
  loopUhf();
#endif
}
