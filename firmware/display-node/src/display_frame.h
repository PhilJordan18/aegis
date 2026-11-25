#pragma once

// Hub <-> CYD display node frame, version 1, on I2C (hub master, CYD slave at 0x42). Specified in
// firmware/locker-controller/README.md, "Display link frame". Self-contained on purpose: a later
// slice copies this header byte for byte into the CYD sketch, and tests/host/run.sh will then
// check that the copies match.
//
// Command (hub -> CYD, master write):
//   magic 0xAE | ver 0x01 | cmd u8 | seq u32 LE | len u8 | payload[len] | CRC-16/CCITT-FALSE BE
//   SHOW_CHALLENGE 0x01: ttlMs u16 LE | action u8 | codeLen u8 + code | uriLen u8 + uri
//   SHOW_STATUS    0x02: ttlMs u16 LE | action u8 | codeLen u8 + code | statusLen u8 + status
//   CLEAR 0x03, PING 0x04: empty payload
// Status (CYD -> hub, master read, 16 bytes):
//   magic 0xEA | ver | fwVer | bootId u32 LE | seq u32 LE | state | err | rsv | CRC-16 BE of 14 bytes

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace aegis {
namespace displayframe {

constexpr uint8_t COMMAND_MAGIC = 0xAE;
constexpr uint8_t STATUS_MAGIC = 0xEA;
constexpr uint8_t VERSION = 1;
constexpr size_t MAX_FRAME = 255;
constexpr size_t HEADER = 8;  // magic, ver, cmd, seq, len
constexpr size_t STATUS_LEN = 16;
constexpr size_t MAX_CODE = 8;
constexpr size_t MAX_URI = 230;
constexpr size_t MAX_STATUS = 24;
constexpr uint16_t MAX_TTL_MS = 60000;

enum Cmd : uint8_t { SHOW_CHALLENGE = 0x01, SHOW_STATUS = 0x02, CLEAR = 0x03, PING = 0x04 };
enum Action : uint8_t { CHECKOUT = 0, RETURN = 1 };
enum State : uint8_t { IDLE = 0, DRAWING = 1, SHOWN = 2, FAILED = 3 };
enum Err : uint8_t { NONE = 0, BAD_CRC = 1, BAD_LEN = 2, BAD_VERSION = 3, UNKNOWN_CMD = 4, URI_TOO_LONG = 5,
                     DRAW_FAILED = 6 };

struct Command {
  uint8_t cmd;
  uint32_t seq;
  uint16_t ttlMs;               // show only
  uint8_t action;               // show only
  char code[MAX_CODE + 1];      // show only
  char text[MAX_URI + 1];       // the URI of a challenge, or the status of a status
};

struct Status {
  uint8_t version;
  uint8_t fwVer;
  uint32_t bootId;
  uint32_t seq;  // last frame handled
  uint8_t state;
  uint8_t err;
};

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF; "123456789" gives 0x29B1.
inline uint16_t crc16(const uint8_t* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= static_cast<uint16_t>(data[i]) << 8;
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021) : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

inline void putU32(uint8_t* p, uint32_t v) {
  for (int i = 0; i < 4; i++) p[i] = static_cast<uint8_t>(v >> (8 * i));
}

inline uint32_t getU32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | static_cast<uint32_t>(p[1]) << 8 | static_cast<uint32_t>(p[2]) << 16 |
         static_cast<uint32_t>(p[3]) << 24;
}

inline bool printable(const char* s, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (s[i] < 0x20 || s[i] > 0x7E) return false;
  }
  return true;
}

inline bool isShow(uint8_t cmd) { return cmd == SHOW_CHALLENGE || cmd == SHOW_STATUS; }

// Frame length written to `out`, 0 when the command breaks a limit (the frame is then not sent).
inline size_t encodeCommand(const Command& c, uint8_t* out, size_t cap) {
  if (cap < MAX_FRAME) return 0;
  size_t n = HEADER;
  if (isShow(c.cmd)) {
    const size_t codeLen = strnlen(c.code, sizeof(c.code));
    const size_t textLen = strnlen(c.text, sizeof(c.text));
    const size_t textMax = c.cmd == SHOW_CHALLENGE ? MAX_URI : MAX_STATUS;
    if (c.ttlMs == 0 || c.ttlMs > MAX_TTL_MS || c.action > RETURN || codeLen == 0 || codeLen > MAX_CODE ||
        !printable(c.code, codeLen) || textLen == 0 || textLen > textMax || !printable(c.text, textLen)) {
      return 0;
    }
    out[n++] = static_cast<uint8_t>(c.ttlMs);
    out[n++] = static_cast<uint8_t>(c.ttlMs >> 8);
    out[n++] = c.action;
    out[n++] = static_cast<uint8_t>(codeLen);
    memcpy(out + n, c.code, codeLen);
    n += codeLen;
    out[n++] = static_cast<uint8_t>(textLen);
    memcpy(out + n, c.text, textLen);
    n += textLen;
  } else if (c.cmd != CLEAR && c.cmd != PING) {
    return 0;
  }
  out[0] = COMMAND_MAGIC;
  out[1] = VERSION;
  out[2] = c.cmd;
  putU32(out + 3, c.seq);
  out[7] = static_cast<uint8_t>(n - HEADER);
  const uint16_t crc = crc16(out, n);
  out[n++] = static_cast<uint8_t>(crc >> 8);
  out[n++] = static_cast<uint8_t>(crc);
  return n;
}

// NONE and `out` filled, or the Err the CYD reports for that frame.
inline Err decodeCommand(const uint8_t* in, size_t n, Command* out) {
  memset(out, 0, sizeof(*out));
  if (n < HEADER + 2 || n > MAX_FRAME || in[0] != COMMAND_MAGIC) return BAD_LEN;
  if (in[1] != VERSION) return BAD_VERSION;
  const size_t len = in[7];
  if (n != HEADER + len + 2) return BAD_LEN;
  if (crc16(in, HEADER + len) != (static_cast<uint16_t>(in[n - 2]) << 8 | in[n - 1])) return BAD_CRC;
  out->cmd = in[2];
  out->seq = getU32(in + 3);
  if (out->cmd == CLEAR || out->cmd == PING) return len == 0 ? NONE : BAD_LEN;
  if (!isShow(out->cmd)) return UNKNOWN_CMD;
  const uint8_t* p = in + HEADER;
  const uint8_t* end = p + len;
  if (end - p < 4) return BAD_LEN;
  out->ttlMs = static_cast<uint16_t>(p[0] | p[1] << 8);
  out->action = p[2];
  const size_t codeLen = p[3];
  p += 4;
  if (codeLen == 0 || codeLen > MAX_CODE || static_cast<size_t>(end - p) < codeLen + 1) return BAD_LEN;
  memcpy(out->code, p, codeLen);
  p += codeLen;
  const size_t textLen = *p++;
  if (out->cmd == SHOW_CHALLENGE && textLen > MAX_URI) return URI_TOO_LONG;
  if (textLen == 0 || textLen > MAX_URI || (out->cmd == SHOW_STATUS && textLen > MAX_STATUS) ||
      static_cast<size_t>(end - p) != textLen) {
    return BAD_LEN;
  }
  memcpy(out->text, p, textLen);
  if (out->ttlMs == 0 || out->ttlMs > MAX_TTL_MS || out->action > RETURN || !printable(out->code, codeLen) ||
      !printable(out->text, textLen)) {
    return BAD_LEN;
  }
  return NONE;
}

inline void encodeStatus(const Status& s, uint8_t out[STATUS_LEN]) {
  out[0] = STATUS_MAGIC;
  out[1] = s.version;
  out[2] = s.fwVer;
  putU32(out + 3, s.bootId);
  putU32(out + 7, s.seq);
  out[11] = s.state;
  out[12] = s.err;
  out[13] = 0;
  const uint16_t crc = crc16(out, 14);
  out[14] = static_cast<uint8_t>(crc >> 8);
  out[15] = static_cast<uint8_t>(crc);
}

// True for a well-formed version 1 status. An unpowered or absent slave reads as 0xFF bytes.
inline bool decodeStatus(const uint8_t* in, size_t n, Status* out) {
  if (n != STATUS_LEN || in[0] != STATUS_MAGIC || in[1] != VERSION) return false;
  if (crc16(in, 14) != (static_cast<uint16_t>(in[14]) << 8 | in[15])) return false;
  out->version = in[1];
  out->fwVer = in[2];
  out->bootId = getU32(in + 3);
  out->seq = getU32(in + 7);
  out->state = in[11];
  out->err = in[12];
  return true;
}

}  // namespace displayframe
}  // namespace aegis
