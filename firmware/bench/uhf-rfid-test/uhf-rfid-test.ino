// Bench test: M5Stack UHF RFID Unit (JRD-4035) on one ESP32 UART.
//
// Polls the reader repeatedly and, at the end of each stabilization window,
// prints what an RFID_SCAN_COMPLETED message would carry (doc 10 §12.1): the
// reader status and each observed EPC with its read count. No MQTT, no RS-485.
//
// Frame format (binary):  BB <type> <cmd> <len hi> <len lo> <params> <checksum> 7E
//   checksum = sum of the bytes between BB and the checksum, low byte.
//   Single poll command : BB 00 22 00 00 22 7E
//   Tag notification    : BB 02 22 <len> <rssi> <PC 2> <EPC> <CRC 2> <checksum> 7E
//   Error / no tag      : BB 01 FF 00 01 <code> <checksum> 7E   (code 15 = no tag)

#include <Arduino.h>

// ESP32 RX <- unit TX, ESP32 TX -> unit RX. Not 32/33 (RS-485 link), not 16/17 and
// 21/22/26/27 (PSRAM and camera on the WROVER), not 0/1/2/3/12/15 (boot and USB).
constexpr int UHF_RX_PIN = 13;
constexpr int UHF_TX_PIN = 14;
constexpr uint32_t UHF_BAUD = 115200;
constexpr uint32_t USB_BAUD = 115200;

constexpr uint32_t WINDOW_MS = 3000;    // doc 10 caps a scan window at 10 s
constexpr uint32_t POLL_GAP_MS = 100;   // one single-poll command per gap
constexpr size_t MAX_TAGS = 32;         // doc 10 §12.1 limit
constexpr size_t MAX_EPC_BYTES = 32;
constexpr size_t MAX_FRAME = 64;
bool dumpFrames = false;                // 'd' toggles a hex dump of every received frame
// Set-power command (B6), in 0.01 dBm. 'p' cycles 20 -> 15 -> 10 dBm; 20 dBm = 100 mW, the
// unit's stated maximum. A lower power is how a neighbour cell's tag is kept out (POC-01).
constexpr uint16_t POWER_STEPS[] = {2000, 1500, 1000};
size_t powerStep = 0;

// POC-01 decision rules, approved before any measurement (README "Decision thresholds").
constexpr uint16_t PRESENT_MIN_READS = 3;      // doc 10 §12.2: three consistent reads
constexpr uint32_t RUN_REPORT_AT[] = {20, 50};  // windows per test in the README procedure

HardwareSerial uhf(1);

// Declared before any function: the Arduino IDE inserts prototypes above the first
// function, so types used in signatures must already exist there.
// One run = one test of the README procedure, started with 'r'. A window is "present" for a
// tag read at least PRESENT_MIN_READS times while the reader answered (doc 10 §12.2).
constexpr size_t MAX_RUN_TAGS = 8;

struct RunTag {
  char epc[MAX_EPC_BYTES * 2 + 1];
  uint32_t presentWindows;  // windows with >= PRESENT_MIN_READS reads
  uint32_t seenWindows;     // windows with at least one read
  uint16_t maxReads;
};

struct Run {
  bool active = false;
  uint32_t windows = 0;
  uint32_t healthy = 0;
  uint32_t anyPresent = 0;          // windows where at least one tag was present
  uint32_t firstPresentWindow = 0;  // 1 = the first window after 'r'; 0 = none yet
  RunTag tags[MAX_RUN_TAGS];
  size_t tagCount = 0;
  bool tagsOverflowed = false;
};


// ---------------------------------------------------------------- framing

size_t buildFrame(uint8_t* f, uint8_t cmd, const uint8_t* params, uint16_t plen) {
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

void sendCommand(uint8_t cmd, const uint8_t* params, uint16_t plen) {
  uint8_t f[MAX_FRAME];
  size_t n = buildFrame(f, cmd, params, plen);
  uhf.write(f, n);
}

void printHex(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) Serial.printf("%02X ", data[i]);
}

struct FrameReader {
  uint8_t buf[MAX_FRAME];
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
      if (total > MAX_FRAME) {
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

FrameReader reader;

// ---------------------------------------------------------------- scan window

struct Tag {
  char epc[MAX_EPC_BYTES * 2 + 1];
  uint16_t reads;
};

Tag tags[MAX_TAGS];
size_t tagCount = 0;
bool sawValidFrame = false;  // distinguishes "no tag" from "reader silent"
uint32_t windowStartMs = 0;
uint32_t lastPollMs = 0;

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

void handleFrame(const uint8_t* f, size_t n) {
  bool noTag = n == 8 && f[1] == 0x01 && f[2] == 0xFF && f[5] == 0x15;  // routine reply, not worth printing
  if (dumpFrames && !noTag) {
    Serial.print("[rx] ");
    printHex(f, n);
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
  } else if (type == 0x01 && cmd == 0xB6 && plen >= 1) {
    Serial.printf("[uhf] set power %s (code 0x%02X)\n", p[0] == 0x00 ? "accepted" : "REFUSED", p[0]);
  }
}

// ---------------------------------------------------------------- POC-01 run

Run run;

uint16_t currentPowerCentiDbm() { return POWER_STEPS[powerStep]; }

RunTag* runTag(const char* epc) {
  for (size_t i = 0; i < run.tagCount; i++) {
    if (strcmp(run.tags[i].epc, epc) == 0) return &run.tags[i];
  }
  if (run.tagCount == MAX_RUN_TAGS) {
    run.tagsOverflowed = true;
    return nullptr;
  }
  RunTag* t = &run.tags[run.tagCount++];
  strcpy(t->epc, epc);
  t->presentWindows = 0;
  t->seenWindows = 0;
  t->maxReads = 0;
  return t;
}

void printRun(const char* label) {
  Serial.printf("[%s] power=%u.%02u dBm windows=%lu healthy=%lu windowsWithATagPresent=%lu firstPresentWindow=%s",
                label, currentPowerCentiDbm() / 100, currentPowerCentiDbm() % 100,
                static_cast<unsigned long>(run.windows), static_cast<unsigned long>(run.healthy),
                static_cast<unsigned long>(run.anyPresent), run.firstPresentWindow ? "" : "none\n");
  if (run.firstPresentWindow) Serial.printf("%lu\n", static_cast<unsigned long>(run.firstPresentWindow));
  for (size_t i = 0; i < run.tagCount; i++) {
    const RunTag& t = run.tags[i];
    Serial.printf("  epc=%s present=%lu/%lu seen=%lu maxReads=%u\n", t.epc,
                  static_cast<unsigned long>(t.presentWindows), static_cast<unsigned long>(run.windows),
                  static_cast<unsigned long>(t.seenWindows), t.maxReads);
  }
  if (run.tagsOverflowed) Serial.println("  more tags than the run can list; clear the area");
}

void countWindow() {
  if (!run.active) return;
  run.windows++;
  if (sawValidFrame) run.healthy++;
  bool any = false;
  for (size_t i = 0; i < tagCount; i++) {
    RunTag* t = runTag(tags[i].epc);
    if (t == nullptr) continue;
    t->seenWindows++;
    if (tags[i].reads > t->maxReads) t->maxReads = tags[i].reads;
    // An unhealthy window proves nothing, so it never counts as present (doc 10 §12.1).
    if (sawValidFrame && tags[i].reads >= PRESENT_MIN_READS) {
      t->presentWindows++;
      any = true;
    }
  }
  if (any) {
    run.anyPresent++;
    if (run.firstPresentWindow == 0) run.firstPresentWindow = run.windows;
  }
  for (uint32_t at : RUN_REPORT_AT) {
    if (run.windows == at) printRun(at == RUN_REPORT_AT[sizeof(RUN_REPORT_AT) / sizeof(RUN_REPORT_AT[0]) - 1] ? "RUN RESULT" : "RUN");
  }
}

void printWindow() {
  Serial.printf("[scan] %swindow=%lums readerStatus=%s tags=%u\n", run.active ? "" : "(no run) ",
                static_cast<unsigned long>(WINDOW_MS), sawValidFrame ? "HEALTHY" : "UNKNOWN",
                static_cast<unsigned>(tagCount));
  for (size_t i = 0; i < tagCount; i++) {
    Serial.printf("  RFID_UHF epc=%s readCount=%u%s\n", tags[i].epc, tags[i].reads,
                  sawValidFrame && tags[i].reads >= PRESENT_MIN_READS ? " PRESENT" : "");
  }
  if (!sawValidFrame) Serial.println("  no valid frame from the reader: check wiring, power, baud");
  countWindow();
  tagCount = 0;
  sawValidFrame = false;
}

// ---------------------------------------------------------------- common

// Checks the builder against the single-poll frame documented by M5Stack.
bool selfCheck() {
  const uint8_t expected[] = {0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E};
  uint8_t f[MAX_FRAME];
  size_t n = buildFrame(f, 0x22, nullptr, 0);
  return n == sizeof(expected) && memcmp(f, expected, n) == 0;
}

void setPower() {
  const uint16_t power = currentPowerCentiDbm();
  const uint8_t params[] = {static_cast<uint8_t>(power >> 8), static_cast<uint8_t>(power & 0xFF)};
  sendCommand(0xB6, params, 2);
  Serial.printf("[uhf] set power to %u dBm requested\n", power / 100);
}

void startRun() {
  run = Run();
  run.active = true;
  tagCount = 0;
  sawValidFrame = false;
  windowStartMs = millis();
  Serial.printf("[RUN] started at %u dBm: window 1 starts now\n", currentPowerCentiDbm() / 100);
}

void handleUsbKeys() {
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == 'r') startRun();
    if (c == 's') printRun("RUN");
    if (c == 'd') {
      dumpFrames = !dumpFrames;
      Serial.printf("[uhf] frame dump %s\n", dumpFrames ? "on" : "off");
    }
    if (c == 'p') {
      powerStep = (powerStep + 1) % (sizeof(POWER_STEPS) / sizeof(POWER_STEPS[0]));
      setPower();
      // A run mixing two powers would not answer any threshold: restart it.
      if (run.active) startRun();
    }
  }
}

void setup() {
  Serial.begin(USB_BAUD);
  uhf.begin(UHF_BAUD, SERIAL_8N1, UHF_RX_PIN, UHF_TX_PIN);
  delay(200);
  Serial.printf("UHF test ready, rx=%d tx=%d baud=%lu, self-check %s\n", UHF_RX_PIN, UHF_TX_PIN,
                static_cast<unsigned long>(UHF_BAUD), selfCheck() ? "OK" : "FAILED");

  // Get hardware version (param 0x00): the reply proves the link before any tag is read.
  const uint8_t versionParam[] = {0x00};
  sendCommand(0x03, versionParam, 1);
  delay(100);

  setPower();
  windowStartMs = millis();
  Serial.println("Keys: 'r' start a run (window 1 starts now), 's' run summary, 'p' power 20/15/10 dBm, 'd' frame dump");
}

void loop() {
  handleUsbKeys();
  uint32_t now = millis();

  if (now - lastPollMs >= POLL_GAP_MS) {
    lastPollMs = now;
    sendCommand(0x22, nullptr, 0);
  }

  while (reader.poll(uhf)) handleFrame(reader.buf, reader.frameLen);

  if (now - windowStartMs >= WINDOW_MS) {
    windowStartMs = now;
    printWindow();
  }
}
