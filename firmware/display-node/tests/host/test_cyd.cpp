// Host tests of the CYD display node link logic (no board needed).
// Run with tests/host/run.sh. Assert-based: a failure aborts with the failing line.

#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "../../src/cyd_state.h"

using namespace aegis;
using namespace aegis::displayframe;

namespace {

const char* const TOKEN = "Zq7Xw2Kp9Lm4Rt6Vb8Nc3Hd5Jf1Gs0Ty";  // never in the state object after a draw

struct FakeBoard : CydBoard {
  bool drawOk = true;
  int challenges = 0, statuses = 0, homes = 0, preloads = 0, depth = 0;
  std::string lastUri, lastStatus, lastCode;
  uint8_t lastAction = 0xFF;
  uint16_t lastTtl = 0;
  uint8_t preloaded[STATUS_LEN] = {};
  uint8_t stateDuringDraw = 0xFF;

  Status decoded() const {
    Status s = {};
    assert(decodeStatus(preloaded, STATUS_LEN, &s));
    return s;
  }
  bool drawChallenge(uint8_t action, const char* code, const char* uri, uint16_t ttlMs) override {
    assert(depth == 0);
    challenges++;
    stateDuringDraw = decoded().state;
    lastAction = action;
    lastCode = code;
    lastUri = uri;
    lastTtl = ttlMs;
    return drawOk;
  }
  bool drawStatus(uint8_t action, const char* code, const char* status, uint16_t ttlMs) override {
    assert(depth == 0);
    statuses++;
    stateDuringDraw = decoded().state;
    lastAction = action;
    lastCode = code;
    lastStatus = status;
    lastTtl = ttlMs;
    return drawOk;
  }
  void drawHome() override { homes++; }
  void preload(const uint8_t* s) override {
    assert(depth == 0);
    preloads++;
    memcpy(preloaded, s, STATUS_LEN);
  }
  void lock() override { assert(++depth == 1); }
  void unlock() override { assert(--depth == 0); }
  void log(uint8_t, uint32_t, uint8_t, uint8_t) override {}
};

std::vector<uint8_t> frame(uint8_t cmd, uint32_t seq, const char* text = "", uint16_t ttlMs = 60000,
                           const char* code = "A1", uint8_t action = CHECKOUT) {
  Command c = {};
  c.cmd = cmd;
  c.seq = seq;
  c.ttlMs = ttlMs;
  c.action = action;
  snprintf(c.code, sizeof(c.code), "%s", code);
  snprintf(c.text, sizeof(c.text), "%s", text);
  std::vector<uint8_t> out(MAX_FRAME);
  out.resize(encodeCommand(c, out.data(), out.size()));
  assert(!out.empty());
  return out;
}

// A frame with any header and payload, with a correct CRC (for what the hub encoder refuses).
std::vector<uint8_t> raw(uint8_t cmd, uint32_t seq, const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> f = {COMMAND_MAGIC, VERSION, cmd, 0, 0, 0, 0, static_cast<uint8_t>(payload.size())};
  putU32(f.data() + 3, seq);
  f.insert(f.end(), payload.begin(), payload.end());
  const uint16_t crc = crc16(f.data(), f.size());
  f.push_back(static_cast<uint8_t>(crc >> 8));
  f.push_back(static_cast<uint8_t>(crc));
  return f;
}

std::string uri(size_t len) {
  std::string u = std::string("aegis://challenge?t=") + TOKEN + "&c=";
  while (u.size() < len) u += 'x';
  u.resize(len);
  return u;
}

bool holds(const CydState& s, const char* needle) {
  const auto* p = reinterpret_cast<const uint8_t*>(&s);
  const size_t n = strlen(needle);
  for (size_t i = 0; i + n <= sizeof(s); i++) {
    if (memcmp(p + i, needle, n) == 0) return true;
  }
  return false;
}

struct Node {
  FakeBoard board;
  CydState state{board, 0xC0FFEE01};
  uint32_t now = 1000;
  Node() { state.begin(); }
  void send(const std::vector<uint8_t>& f) { state.receive(f.data(), f.size(), now); }
  void run(uint32_t ms = 0) {
    now += ms;
    state.loop(now);
  }
  void deliver(const std::vector<uint8_t>& f, uint32_t ms = 1) {
    send(f);
    run(ms);
  }
  Status status() { return board.decoded(); }
};

void bootIsIdleOnHomeWithBootId() {
  Node n;
  const Status s = n.status();
  assert(n.board.homes == 1 && n.board.preloads == 1);
  assert(s.version == VERSION && s.fwVer == CydState::FW_VER && s.bootId == 0xC0FFEE01);
  assert(s.seq == 0 && s.state == IDLE && s.err == NONE);
  assert(n.state.screen() == CydState::HOME);
  uint8_t again[STATUS_LEN];
  n.state.status(again);  // what onRequest preloads again
  assert(memcmp(again, n.board.preloaded, STATUS_LEN) == 0);
}

void statusRoundTripsWithTheHubDecoder() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 0x12345678, "aegis://x"));
  Status s = {};
  assert(decodeStatus(n.board.preloaded, STATUS_LEN, &s));
  assert(s.seq == 0x12345678 && s.state == SHOWN && s.err == NONE && s.bootId == 0xC0FFEE01);
  uint8_t bad[STATUS_LEN];
  memcpy(bad, n.board.preloaded, STATUS_LEN);
  bad[7] ^= 1;
  assert(!decodeStatus(bad, STATUS_LEN, &s));
}

void challengeGoesDrawingThenShown() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 7, "aegis://c?t=1", 45000, "B2", RETURN));
  assert(n.board.challenges == 1 && n.board.stateDuringDraw == DRAWING);
  assert(n.board.lastUri == "aegis://c?t=1" && n.board.lastCode == "B2" && n.board.lastAction == RETURN);
  assert(n.board.lastTtl == 45000);
  const Status s = n.status();
  assert(s.seq == 7 && s.state == SHOWN && s.err == NONE);
  assert(n.state.screen() == CydState::CHALLENGE);
}

void sameSeqTwiceDrawsOnce() {
  Node n;
  const auto f = frame(SHOW_CHALLENGE, 9, "aegis://c?t=1");
  n.deliver(f);
  const int preloads = n.board.preloads;
  n.deliver(f);
  assert(n.board.challenges == 1);
  assert(n.board.preloads == preloads + 1);  // the status is preloaded again
  assert(n.status().seq == 9 && n.status().state == SHOWN);
}

void newSeqSupersedes() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 9, "aegis://c?t=1"));
  n.deliver(frame(SHOW_CHALLENGE, 10, "aegis://c?t=2"));
  assert(n.board.challenges == 2 && n.board.lastUri == "aegis://c?t=2");
  assert(n.status().seq == 10 && n.status().state == SHOWN);
}

void newestFrameInTheMailboxWins() {
  Node n;
  n.send(frame(SHOW_CHALLENGE, 20, "aegis://old"));
  n.send(frame(SHOW_CHALLENGE, 21, "aegis://new"));
  n.run(1);
  n.run(1);
  assert(n.board.challenges == 1 && n.board.lastUri == "aegis://new" && n.status().seq == 21);
}

void badFramesSetErrAndKeepState() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 30, "aegis://c?t=1"));
  const int draws = n.board.challenges;

  auto crc = frame(SHOW_CHALLENGE, 31, "aegis://c?t=2");
  crc.back() ^= 0xFF;
  n.deliver(crc);
  Status s = n.status();
  assert(s.err == BAD_CRC && s.seq == 31 && s.state == SHOWN);

  auto ver = frame(PING, 32);
  ver[1] = 2;
  n.deliver(ver);
  s = n.status();
  assert(s.err == BAD_VERSION && s.seq == 32 && s.state == SHOWN);

  auto len = frame(PING, 33);
  len.pop_back();
  n.deliver(len);
  s = n.status();
  assert(s.err == BAD_LEN && s.seq == 33 && s.state == SHOWN);

  n.deliver(raw(0x09, 34, {}));
  s = n.status();
  assert(s.err == UNKNOWN_CMD && s.seq == 34 && s.state == SHOWN);

  std::vector<uint8_t> p = {0x60, 0xEA, CHECKOUT, 2, 'A', '1', 231};  // ttl 60000, URI of 231
  p.insert(p.end(), 231, 'u');
  n.deliver(raw(SHOW_CHALLENGE, 35, p));
  s = n.status();
  assert(s.err == URI_TOO_LONG && s.seq == 35 && s.state == SHOWN);

  std::vector<uint8_t> big(300, 0xAA);
  big[0] = COMMAND_MAGIC;
  big[1] = VERSION;
  putU32(big.data() + 3, 36);
  n.deliver(big);
  s = n.status();
  assert(s.err == BAD_LEN && s.seq == 36 && s.state == SHOWN);

  n.deliver(std::vector<uint8_t>{0xAE, 0x01});  // too short for a seq: the last one stays
  s = n.status();
  assert(s.err == BAD_LEN && s.seq == 36 && s.state == SHOWN);

  assert(n.board.challenges == draws && n.state.screen() == CydState::CHALLENGE);
  n.deliver(frame(PING, 37));
  assert(n.status().err == NONE && n.status().state == SHOWN);
}

void corruptedFrameDoesNotBlockItsResend() {
  Node n;
  const auto good = frame(SHOW_CHALLENGE, 40, "aegis://c?t=1");
  auto bad = good;
  bad[12] ^= 0x01;
  n.deliver(bad);
  assert(n.status().err == BAD_CRC && n.status().seq == 40 && n.status().state == IDLE);
  n.deliver(good);
  assert(n.board.challenges == 1 && n.status().state == SHOWN && n.status().err == NONE);
}

void failedDrawReportsDrawFailed() {
  Node n;
  n.board.drawOk = false;
  n.deliver(frame(SHOW_CHALLENGE, 50, uri(218).c_str()));
  const Status s = n.status();
  assert(s.state == FAILED && s.err == DRAW_FAILED && s.seq == 50);
  assert(n.state.screen() == CydState::HOME && n.board.homes == 2);
}

void ttlRunsFromReception() {
  Node n;
  n.send(frame(SHOW_CHALLENGE, 60, "aegis://c?t=1", 5000));
  const uint32_t rx = n.now;
  n.run(400);  // the loop picks it up late: the ttl still counts from reception
  assert(n.state.remainingMs(n.now) == 4600);
  n.now = rx + 4999;
  n.send(frame(PING, 61));  // keep the hub alive
  n.run(0);
  assert(n.status().state == SHOWN);
  n.now = rx + 5000;
  n.run(0);
  assert(n.status().state == IDLE && n.status().seq == 61 && n.state.screen() == CydState::HOME);
  assert(n.board.homes == 2 && n.state.remainingMs(n.now) == 0);
}

void statusScreenGoesHomeAtItsTtl() {
  Node n;
  n.deliver(frame(SHOW_STATUS, 70, "CONFIRMED", 2000, "C3"), 0);
  assert(n.board.statuses == 1 && n.board.lastStatus == "CONFIRMED" && n.board.stateDuringDraw == DRAWING);
  assert(n.status().state == SHOWN && n.state.screen() == CydState::RESULT);
  n.run(1999);
  assert(n.status().state == SHOWN);
  n.run(1);
  assert(n.status().state == IDLE && n.state.screen() == CydState::HOME);
}

void clearGoesHome() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 80, "aegis://c?t=1"));
  n.deliver(frame(CLEAR, 81));
  const Status s = n.status();
  assert(s.state == IDLE && s.seq == 81 && s.err == NONE && n.state.screen() == CydState::HOME);
  assert(n.board.homes == 2);
}

void silenceGoesHomeAndPingKeepsAlive() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 90, "aegis://c?t=1"), 0);
  for (uint32_t seq = 91; seq < 96; seq++) {  // a PING every second: no redraw, still shown
    n.run(1000);
    n.deliver(frame(PING, seq), 0);
  }
  assert(n.board.challenges == 1 && n.board.homes == 1 && n.status().state == SHOWN && n.status().seq == 95);
  n.run(2999);
  assert(n.status().state == SHOWN);
  n.run(1);
  assert(n.status().state == IDLE && n.state.screen() == CydState::HOME && n.board.homes == 2);
}

void writeStampedAfterTheLoopClockDoesNotClear() {
  Node n;
  n.deliver(frame(SHOW_CHALLENGE, 100, "aegis://c?t=1"), 0);
  const uint8_t junk = 0;
  n.state.receive(&junk, 1, n.now + 5);  // the I2C task stamps a write after loop() read millis()
  n.run(0);
  n.run(0);
  assert(n.status().state == SHOWN);
}

void longestRealUriIsAccepted() {
  Node n;
  const std::string u = uri(218);
  const auto f = frame(SHOW_CHALLENGE, 110, u.c_str(), 60000, "A1B2C3D4");
  assert(f.size() == 241);  // header 8, ttl 2, action 1, code 1+8, URI 1+218, CRC 2
  n.deliver(f);
  assert(n.board.lastUri == u && n.board.lastCode == "A1B2C3D4" && n.status().state == SHOWN);
}

void tokenIsWipedAfterDrawClearAndFailure() {
  Node n;
  const std::string u = uri(218);
  n.send(frame(SHOW_CHALLENGE, 120, u.c_str()));
  assert(holds(n.state, TOKEN));  // the scan does find it while it waits in the mailbox
  n.run(1);
  assert(n.board.lastUri == u && !holds(n.state, TOKEN));

  n.send(frame(SHOW_CHALLENGE, 121, u.c_str()));
  n.send(frame(CLEAR, 122));
  n.run(1);
  assert(n.board.challenges == 1 && !holds(n.state, TOKEN));

  n.board.drawOk = false;
  n.deliver(frame(SHOW_CHALLENGE, 123, u.c_str()));
  assert(n.status().err == DRAW_FAILED && !holds(n.state, TOKEN));

  auto bad = frame(SHOW_CHALLENGE, 124, u.c_str());
  bad.back() ^= 0xFF;
  n.deliver(bad);
  assert(n.status().err == BAD_CRC && !holds(n.state, TOKEN));
}

}  // namespace

int main() {
  bootIsIdleOnHomeWithBootId();
  statusRoundTripsWithTheHubDecoder();
  challengeGoesDrawingThenShown();
  sameSeqTwiceDrawsOnce();
  newSeqSupersedes();
  newestFrameInTheMailboxWins();
  badFramesSetErrAndKeepState();
  corruptedFrameDoesNotBlockItsResend();
  failedDrawReportsDrawFailed();
  ttlRunsFromReception();
  statusScreenGoesHomeAtItsTtl();
  clearGoesHome();
  silenceGoesHomeAndPingKeepsAlive();
  writeStampedAfterTheLoopClockDoesNotClear();
  longestRealUriIsAccepted();
  tokenIsWipedAfterDrawClearAndFailure();
  puts("display node host tests passed");
  return 0;
}
