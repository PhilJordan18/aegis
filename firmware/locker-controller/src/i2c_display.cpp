#include "i2c_display.h"

#include <cstdio>
#include <cstring>

namespace aegis {

using namespace displayframe;

namespace {

// Wrap-safe: true once `now` has reached `deadline`.
bool due(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }

}  // namespace

bool I2cDisplay::available() { return heard_ && platform_.nowMs() - lastStatusMs_ < SILENCE_MS; }

// Only cmd, seq and err are ever logged: never the token, the URI or the payload.
void I2cDisplay::log(const char* what, uint8_t cmd, uint32_t seq, uint8_t err) {
  char line[80];
  snprintf(line, sizeof(line), "%s cmd=%u seq=%lu err=%u", what, cmd, static_cast<unsigned long>(seq), err);
  platform_.log(line);
}

void I2cDisplay::drop() {
  memset(frame_, 0, sizeof(frame_));
  frameLen_ = 0;
  toWrite_ = false;
  awaiting_ = false;
}

// Replaces the frame in flight with `c` under a new seq, and wipes `c`.
bool I2cDisplay::queue(Command& c) {
  drop();
  if (!seeded_) {
    seq_ = platform_.random(0xFFFFFFFFu);  // a hub reboot never reuses the seq the CYD last handled
    seeded_ = true;
  }
  c.seq = ++seq_;
  frameLen_ = encodeCommand(c, frame_, sizeof(frame_));
  memset(&c, 0, sizeof(c));
  if (frameLen_ == 0) return false;
  cmd_ = frame_[2];
  toWrite_ = true;
  writes_ = 0;
  resent_ = false;
  readNext_ = false;
  return true;
}

bool I2cDisplay::show(uint8_t cmd, const char* text, const char* action, const char* compartmentCode, uint16_t ttlMs) {
  Command c = {};
  c.cmd = cmd;
  c.ttlMs = ttlMs;
  const size_t codeLen = strlen(compartmentCode);
  const size_t textLen = strlen(text);
  bool ok = codeLen <= MAX_CODE && textLen <= MAX_URI;
  if (strcmp(action, "CHECKOUT") == 0) {
    c.action = CHECKOUT;
  } else if (strcmp(action, "RETURN") == 0) {
    c.action = RETURN;
  } else {
    ok = false;
  }
  if (ok) {
    memcpy(c.code, compartmentCode, codeLen);
    memcpy(c.text, text, textLen);
  }
  if (!ok || !queue(c)) {  // queue() wipes c, and the encoder refuses whatever breaks a frame limit
    state_ = DrawState::Failed;
    return false;
  }
  state_ = DrawState::Drawing;
  submittedMs_ = platform_.nowMs();
  return true;
}

bool I2cDisplay::showChallenge(const char* uri, const char* action, const char* compartmentCode, uint16_t ttlMs) {
  return show(SHOW_CHALLENGE, uri, action, compartmentCode, ttlMs);
}

bool I2cDisplay::showStatus(const char* action, const char* compartmentCode, const char* status, uint16_t ttlMs) {
  return show(SHOW_STATUS, status, action, compartmentCode, ttlMs);
}

void I2cDisplay::clear() {
  state_ = state_ == DrawState::Drawing ? DrawState::Failed : DrawState::Idle;
  if (toWrite_ && cmd_ == CLEAR) return;  // already waiting to go out
  Command c = {};
  c.cmd = CLEAR;
  queue(c);
}

void I2cDisplay::readStatus(uint32_t now) {
  uint8_t buf[STATUS_LEN];
  Status st;
  if (bus_.read(address_, buf, sizeof(buf)) != sizeof(buf) || !decodeStatus(buf, sizeof(buf), &st)) {
    failures_++;  // absent, unpowered (0xFF) or corrupted: not counted as heard
    return;
  }
  failures_ = 0;
  heard_ = true;
  lastStatusMs_ = now;
  if (bootKnown_ && st.bootId != bootId_) log("display node restarted", 0, st.seq, st.err);
  bootKnown_ = true;
  bootId_ = st.bootId;

  if (!awaiting_ || st.seq != seq_) return;  // about another frame: stale
  if (st.err == BAD_CRC && !resent_) {
    log("display frame corrupted, resending", cmd_, seq_, st.err);
    resent_ = true;
    awaiting_ = false;
    toWrite_ = true;
    writes_ = 0;
  } else if (st.state == SHOWN && st.err == NONE) {
    state_ = DrawState::Drawn;
    drop();
  } else if (st.state == FAILED || st.err != NONE) {
    log("display draw failed", cmd_, seq_, st.err);
    state_ = DrawState::Failed;
    drop();
  }
}

void I2cDisplay::loop() {
  const uint32_t now = platform_.nowMs();

  if (state_ == DrawState::Drawing && due(now, submittedMs_ + DRAW_TIMEOUT_MS)) {
    log("display draw timed out", cmd_, seq_, 0);
    state_ = DrawState::Failed;
    drop();
  }

  if (failures_ >= FAILURES_BEFORE_RESET && (!everReset_ || due(now, lastResetMs_ + RESET_MIN_GAP_MS))) {
    platform_.log("display bus reset");
    bus_.reset();
    everReset_ = true;
    lastResetMs_ = now;
    failures_ = 0;
    return;
  }

  if (!toWrite_ && !awaiting_ && !readNext_ && due(now, nextIdleMs_)) {
    nextIdleMs_ = now + IDLE_PERIOD_MS;
    Command ping = {};
    ping.cmd = PING;
    queue(ping);
  }

  if (toWrite_) {
    writes_++;
    if (bus_.write(address_, frame_, frameLen_)) {
      failures_ = 0;
      toWrite_ = false;
      if (isShow(cmd_)) {
        awaiting_ = true;
        nextReadMs_ = now + DRAW_POLL_MS;
      } else {
        readNext_ = cmd_ == PING;
        memset(frame_, 0, sizeof(frame_));
      }
      return;
    }
    failures_++;
    if (cmd_ != PING) log("display write failed", cmd_, seq_, 0);
    if (writes_ >= MAX_WRITES) {
      if (isShow(cmd_)) state_ = DrawState::Failed;
      drop();
    }
    return;
  }

  if (readNext_ || (awaiting_ && due(now, nextReadMs_))) {
    readNext_ = false;
    nextReadMs_ = now + DRAW_POLL_MS;
    readStatus(now);
  }
}

}  // namespace aegis
