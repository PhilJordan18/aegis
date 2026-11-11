#pragma once

// Hub <-> cell frame, version 1, on each RS-485 segment (ADR-002). Specified in
// firmware/locker-controller/README.md, "Cell link frame". Aegis's own format, not Modbus.
//
// One ASCII line per frame:  <body>,<CRC-16/CCITT-FALSE of body, 4 uppercase hex>\n
//   PING  hub -> cell : P,<seq 8 hex>
//   REPLY cell -> hub : R,<seq 8 hex>,<cellAddress 2 hex>,<bootId 8 hex>,<resetCode 2 hex>
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

constexpr size_t MAX_LINE = 48;  // longest frame (REPLY) is 31 bytes with CRC and newline

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

inline size_t encodePing(uint32_t seq, char* out, size_t cap) {
  char body[16];
  snprintf(body, sizeof(body), "P,%08lX", static_cast<unsigned long>(seq));
  return seal(body, out, cap);
}

inline bool parsePing(const char* body, uint32_t* seq) {
  return strlen(body) == 10 && body[0] == 'P' && body[1] == ',' && parseHex(body + 2, 8, seq);
}

struct Reply {
  uint32_t seq;
  uint8_t cellAddress;
  uint32_t bootId;     // random per cell boot: a change means the cell restarted
  uint8_t resetCode;   // esp_reset_reason_t of the cell, for diagnosis only
};

inline size_t encodeReply(const Reply& r, char* out, size_t cap) {
  char body[32];
  snprintf(body, sizeof(body), "R,%08lX,%02X,%08lX,%02X", static_cast<unsigned long>(r.seq), r.cellAddress,
           static_cast<unsigned long>(r.bootId), r.resetCode);
  return seal(body, out, cap);
}

inline bool parseReply(const char* b, Reply* r) {
  uint32_t address, reset;
  if (strlen(b) != 25 || b[0] != 'R' || b[1] != ',' || b[10] != ',' || b[13] != ',' || b[22] != ',' ||
      !parseHex(b + 2, 8, &r->seq) || !parseHex(b + 11, 2, &address) || !parseHex(b + 14, 8, &r->bootId) ||
      !parseHex(b + 23, 2, &reset)) {
    return false;
  }
  r->cellAddress = static_cast<uint8_t>(address);
  r->resetCode = static_cast<uint8_t>(reset);
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
