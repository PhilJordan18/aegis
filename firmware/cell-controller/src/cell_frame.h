#pragma once

// Hub <-> cell frame, version 3, on each RS-485 segment (ADR-002). Specified in
// firmware/locker-controller/README.md, "Cell link frame". Aegis's own format, not Modbus.
//
// One ASCII line per frame:  <body>,<CRC-16/CCITT-FALSE of body, 4 uppercase hex>\n
//   PING  hub -> cell : P,<seq 8 hex>
//   SCAN  hub -> cell : S,<seq 8 hex>                    starts a scan window, then answered like a PING
//   TAG?  hub -> cell : T,<seq 8 hex>,<index 2 hex>      asks for one tag of the finished window
//   REPLY cell -> hub : R,<seq>,<cellAddress 2 hex>,<bootId 8 hex>,<resetCode 2 hex>,<lock><reader>,
//                       <scan><tagCount 2 hex><scanReader>
//     lock       : L locked, U unlocked, ? unknown        (latch status switch)
//     reader     : H healthy, F faulted, ? unknown        (local UHF reader, between scans)
//     scan       : I no result, W window running, D window done
//     scanReader : H, F or ? for the finished window      (- while there is no finished window)
//   TAG   cell -> hub : E,<seq>,<cellAddress 2 hex>,<index 2 hex>,<readCount 4 hex>,<EPC, 2 to 32 hex>
// Each version breaks the previous one: flash the hub and the cells together.
//
// shortcut: this header is copied byte for byte into firmware/cell-controller/src/ because an
// Arduino sketch only builds files inside its own folder; tests/host/run.sh fails if the copies
// differ. Move both sketches to a shared library if a third file ever needs to be shared.

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace aegis {
namespace cellframe {

constexpr size_t MAX_LINE = 64;  // longest frame (TAG with a 16-byte EPC) is 60 bytes with CRC and newline
constexpr size_t MAX_SCAN_TAGS = 8;  // distinct tags one window can report; more make the window UNKNOWN
constexpr size_t MAX_EPC_BYTES = 16;

inline uint16_t crc16(const char* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= static_cast<uint16_t>(static_cast<uint8_t>(data[i])) << 8;
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021) : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

// Exactly `digits` uppercase hex characters.
inline bool parseHex(const char* s, size_t digits, uint32_t* out) {
  uint32_t value = 0;
  for (size_t i = 0; i < digits; i++) {
    char c = s[i];
    uint32_t nibble;
    if (c >= '0' && c <= '9') {
      nibble = static_cast<uint32_t>(c - '0');
    } else if (c >= 'A' && c <= 'F') {
      nibble = static_cast<uint32_t>(c - 'A' + 10);
    } else {
      return false;
    }
    value = (value << 4) | nibble;
  }
  *out = value;
  return true;
}

// Writes "<body>,<CRC>\n" into out. Returns its length, 0 when it does not fit.
inline size_t seal(const char* body, char* out, size_t cap) {
  int n = snprintf(out, cap, "%s,%04X\n", body, crc16(body, strlen(body)));
  return (n > 0 && static_cast<size_t>(n) < cap) ? static_cast<size_t>(n) : 0;
}

// Verifies the trailing CRC field of a line (without its newline) and strips it in place.
inline bool unseal(char* line) {
  char* comma = strrchr(line, ',');
  if (comma == nullptr || strlen(comma + 1) != 4) return false;
  uint32_t expected;
  if (!parseHex(comma + 1, 4, &expected)) return false;
  if (crc16(line, static_cast<size_t>(comma - line)) != expected) return false;
  *comma = '\0';
  return true;
}

inline size_t encodePing(uint32_t seq, char* out, size_t cap, char kind = 'P') {
  char body[16];
  snprintf(body, sizeof(body), "%c,%08lX", kind, static_cast<unsigned long>(seq));
  return seal(body, out, cap);
}
inline size_t encodeScan(uint32_t seq, char* out, size_t cap) { return encodePing(seq, out, cap, 'S'); }

inline bool parsePing(const char* body, uint32_t* seq, char kind = 'P') {
  return strlen(body) == 10 && body[0] == kind && body[1] == ',' && parseHex(body + 2, 8, seq);
}
inline bool parseScan(const char* body, uint32_t* seq) { return parsePing(body, seq, 'S'); }

inline size_t encodeTagRequest(uint32_t seq, uint8_t index, char* out, size_t cap) {
  char body[16];
  snprintf(body, sizeof(body), "T,%08lX,%02X", static_cast<unsigned long>(seq), index);
  return seal(body, out, cap);
}

inline bool parseTagRequest(const char* b, uint32_t* seq, uint8_t* index) {
  uint32_t i;
  if (strlen(b) != 13 || b[0] != 'T' || b[1] != ',' || b[10] != ',' || !parseHex(b + 2, 8, seq) ||
      !parseHex(b + 11, 2, &i)) {
    return false;
  }
  *index = static_cast<uint8_t>(i);
  return true;
}

// One tag of a finished window: its EPC as uppercase hex and how many times it was read.
struct Tag {
  uint16_t readCount = 0;
  char epc[MAX_EPC_BYTES * 2 + 1] = {};
};

inline size_t encodeTag(uint32_t seq, uint8_t cellAddress, uint8_t index, const Tag& t, char* out, size_t cap) {
  size_t epcLen = strlen(t.epc);
  if (epcLen < 2 || epcLen > MAX_EPC_BYTES * 2 || epcLen % 2 != 0) return 0;
  char body[64];
  snprintf(body, sizeof(body), "E,%08lX,%02X,%02X,%04X,%s", static_cast<unsigned long>(seq), cellAddress, index,
           t.readCount, t.epc);
  return seal(body, out, cap);
}

inline bool parseTag(const char* b, uint32_t* seq, uint8_t* cellAddress, uint8_t* index, Tag* t) {
  size_t len = strlen(b);
  if (len < 24 || len > 22 + MAX_EPC_BYTES * 2 || (len - 22) % 2 != 0) return false;
  uint32_t address, i, count, ignored;
  if (b[0] != 'E' || b[1] != ',' || b[10] != ',' || b[13] != ',' || b[16] != ',' || b[21] != ',' ||
      !parseHex(b + 2, 8, seq) || !parseHex(b + 11, 2, &address) || !parseHex(b + 14, 2, &i) ||
      !parseHex(b + 17, 4, &count)) {
    return false;
  }
  for (size_t k = 22; k < len; k += 2) {
    if (!parseHex(b + k, 2, &ignored)) return false;
  }
  *cellAddress = static_cast<uint8_t>(address);
  *index = static_cast<uint8_t>(i);
  t->readCount = static_cast<uint16_t>(count);
  memcpy(t->epc, b + 22, len - 22);
  t->epc[len - 22] = '\0';
  return true;
}

constexpr char LOCK_LOCKED = 'L';
constexpr char LOCK_UNLOCKED = 'U';
constexpr char READER_HEALTHY = 'H';
constexpr char READER_FAULTED = 'F';
constexpr char STATE_UNKNOWN = '?';
constexpr char SCAN_NONE = 'I';
constexpr char SCAN_RUNNING = 'W';
constexpr char SCAN_DONE = 'D';
constexpr char NO_WINDOW = '-';

struct Reply {
  uint32_t seq;
  uint8_t cellAddress;
  uint32_t bootId;     // random per cell boot: a change means the cell restarted
  uint8_t resetCode;   // esp_reset_reason_t of the cell, for diagnosis only
  char lock = STATE_UNKNOWN;
  char reader = STATE_UNKNOWN;
  char scan = SCAN_NONE;
  uint8_t tagCount = 0;
  char scanReader = NO_WINDOW;
};

inline bool isLock(char c) { return c == LOCK_LOCKED || c == LOCK_UNLOCKED || c == STATE_UNKNOWN; }
inline bool isReader(char c) { return c == READER_HEALTHY || c == READER_FAULTED || c == STATE_UNKNOWN; }
inline bool isScan(char c) { return c == SCAN_NONE || c == SCAN_RUNNING || c == SCAN_DONE; }
// A finished window carries its reader verdict; otherwise there is none.
inline bool scanFits(char scan, uint8_t tags, char scanReader) {
  if (!isScan(scan) || tags > MAX_SCAN_TAGS) return false;
  if (scan == SCAN_DONE) return isReader(scanReader);
  return scanReader == NO_WINDOW && tags == 0;
}

// Contract values of doc 10 §14 (lockState, readerStatus).
inline const char* lockStateName(char c) {
  return c == LOCK_LOCKED ? "LOCKED" : c == LOCK_UNLOCKED ? "UNLOCKED" : "UNKNOWN";
}
inline const char* readerStatusName(char c) {
  return c == READER_HEALTHY ? "HEALTHY" : c == READER_FAULTED ? "FAULTED" : "UNKNOWN";
}

inline size_t encodeReply(const Reply& r, char* out, size_t cap) {
  if (!isLock(r.lock) || !isReader(r.reader) || !scanFits(r.scan, r.tagCount, r.scanReader)) return 0;
  char body[40];
  snprintf(body, sizeof(body), "R,%08lX,%02X,%08lX,%02X,%c%c,%c%02X%c", static_cast<unsigned long>(r.seq),
           r.cellAddress, static_cast<unsigned long>(r.bootId), r.resetCode, r.lock, r.reader, r.scan, r.tagCount,
           r.scanReader);
  return seal(body, out, cap);
}

inline bool parseReply(const char* b, Reply* r) {
  uint32_t address, reset, tags;
  if (strlen(b) != 33 || b[0] != 'R' || b[1] != ',' || b[10] != ',' || b[13] != ',' || b[22] != ',' ||
      b[25] != ',' || b[28] != ',' || !parseHex(b + 2, 8, &r->seq) || !parseHex(b + 11, 2, &address) ||
      !parseHex(b + 14, 8, &r->bootId) || !parseHex(b + 23, 2, &reset) || !isLock(b[26]) || !isReader(b[27]) ||
      !parseHex(b + 30, 2, &tags) || tags > MAX_SCAN_TAGS || !scanFits(b[29], static_cast<uint8_t>(tags), b[32])) {
    return false;
  }
  r->cellAddress = static_cast<uint8_t>(address);
  r->resetCode = static_cast<uint8_t>(reset);
  r->lock = b[26];
  r->reader = b[27];
  r->scan = b[29];
  r->tagCount = static_cast<uint8_t>(tags);
  r->scanReader = b[32];
  return true;
}

// Splits a byte stream into lines. push() returns true when `buf` holds a complete line; an
// oversized line comes back once as an empty `buf` with `overflowed` set.
struct LineReader {
  char buf[MAX_LINE] = {};
  size_t len = 0;
  bool overflowed = false;

  bool push(char c) {
    if (c == '\r') return false;
    if (c == '\n') {
      buf[overflowed ? 0 : len] = '\0';
      len = 0;
      return true;
    }
    if (overflowed) return false;
    if (len < MAX_LINE - 1) {
      buf[len++] = c;
    } else {
      overflowed = true;
    }
    return false;
  }
  void clearOverflow() { overflowed = false; }
};

}  // namespace cellframe
}  // namespace aegis
