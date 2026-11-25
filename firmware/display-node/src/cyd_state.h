#pragma once

// CYD side of the hub display link (frame v1 in display_frame.h): single-slot mailbox, frame
// checks, the IDLE / DRAWING / SHOWN / FAILED state machine, the 16-byte status and local
// clearing. No hardware and no clock (`now` is injected), so tests/host runs it as is.

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "display_frame.h"

namespace aegis {

// What the state machine needs from the board. The sketch wires it to the TFT, Wire and Serial.
class CydBoard {
 public:
  // Draw a screen and return once it is fully on the panel; false when it could not be drawn.
  virtual bool drawChallenge(uint8_t action, const char* code, const char* uri, uint16_t ttlMs) = 0;
  virtual bool drawStatus(uint8_t action, const char* code, const char* status, uint16_t ttlMs) = 0;
  virtual void drawHome() = 0;
  // Make `status` (STATUS_LEN bytes) what the next master read returns.
  virtual void preload(const uint8_t* status) = 0;
  // Guards the mailbox and the status bytes, shared with the I2C task. Never held while drawing.
  virtual void lock() = 0;
  virtual void unlock() = 0;
  // Only cmd, seq, state and err: never the payload.
  virtual void log(uint8_t cmd, uint32_t seq, uint8_t state, uint8_t err) = 0;

 protected:
  ~CydBoard() = default;
};

class CydState {
 public:
  static constexpr uint8_t FW_VER = 1;
  static constexpr uint32_t SILENCE_MS = 3000;  // home after this long without any write from the hub
  enum Screen : uint8_t { HOME, CHALLENGE, RESULT };

  CydState(CydBoard& board, uint32_t bootId) : board_(board), bootId_(bootId) {}

  // Boot: home screen, IDLE, status preloaded.
  void begin() {
    goHome();
    publish(0);
  }

  // I2C task (onReceive): copy only, the newest frame wins. A write longer than MAX_FRAME keeps
  // its length so loop() reports BAD_LEN.
  void receive(const uint8_t* data, size_t n, uint32_t now) {
    board_.lock();
    memset(box_, 0, sizeof(box_));
    memcpy(box_, data, n < sizeof(box_) ? n : sizeof(box_));
    boxLen_ = n;
    boxFull_ = true;
    rxMs_ = now;
    board_.unlock();
  }

  // I2C task (onRequest): the status bytes to preload again.
  void status(uint8_t out[displayframe::STATUS_LEN]) {
    board_.lock();
    memcpy(out, status_, sizeof(status_));
    board_.unlock();
  }

  // Main loop: handles the frame waiting in the mailbox, or clears the screen once its ttl has
  // elapsed or the hub has been silent for SILENCE_MS.
  void loop(uint32_t now) {
    board_.lock();
    const bool got = boxFull_;
    const size_t n = boxLen_;
    const uint32_t rxMs = rxMs_;
    if (got) {
      memcpy(frame_, box_, sizeof(frame_));
      memset(box_, 0, sizeof(box_));
      boxFull_ = false;
      boxLen_ = 0;
    }
    board_.unlock();

    if (got) {
      handle(n, rxMs);
      wipe();
    } else if (screen_ != HOME && (elapsed(now, deadline_) || elapsed(now, rxMs + SILENCE_MS))) {
      goHome();
      state_ = displayframe::IDLE;
      err_ = displayframe::NONE;
      publish(0);
    }
  }

  Screen screen() const { return screen_; }
  uint8_t state() const { return state_; }
  // Time left before the shown screen goes back home.
  uint32_t remainingMs(uint32_t now) const {
    return screen_ == HOME || elapsed(now, deadline_) ? 0 : deadline_ - now;
  }

 private:
  // Wrap-safe, and false while `now` is behind `t` (a write stamped after loop() read the clock).
  static bool elapsed(uint32_t now, uint32_t t) { return static_cast<int32_t>(now - t) >= 0; }

  void handle(size_t n, uint32_t rxMs) {
    using namespace displayframe;
    const Err e = decodeCommand(frame_, n, &cmd_);
    const uint8_t cmd = n > 2 ? frame_[2] : 0;
    if (e != NONE) {
      // Report the frame's own seq: the hub matches it to resend a BAD_CRC or fail fast.
      if (n >= HEADER) seq_ = getU32(frame_ + 3);
      err_ = e;
      publish(cmd);
      return;
    }
    if (handled_ && cmd_.seq == handledSeq_) {  // a repeat: same answer, no redraw
      publish(cmd);
      return;
    }
    handled_ = true;
    handledSeq_ = cmd_.seq;
    seq_ = cmd_.seq;
    err_ = NONE;
    if (cmd == CLEAR) {
      goHome();
      state_ = IDLE;
    } else if (isShow(cmd)) {
      state_ = DRAWING;
      publish(cmd);
      const uint32_t deadline = rxMs + cmd_.ttlMs;  // the ttl runs from reception
      const bool ok = cmd == SHOW_CHALLENGE ? board_.drawChallenge(cmd_.action, cmd_.code, cmd_.text, cmd_.ttlMs)
                                            : board_.drawStatus(cmd_.action, cmd_.code, cmd_.text, cmd_.ttlMs);
      wipe();  // the token goes as soon as the QR is on the panel
      if (ok) {
        state_ = SHOWN;
        screen_ = cmd == SHOW_CHALLENGE ? CHALLENGE : RESULT;
        deadline_ = deadline;
      } else {
        goHome();
        state_ = FAILED;
        err_ = DRAW_FAILED;
      }
    }  // PING: only the seq moves
    publish(cmd);
  }

  void goHome() {
    wipe();
    board_.drawHome();
    screen_ = HOME;
  }

  void wipe() {
    memset(frame_, 0, sizeof(frame_));
    memset(&cmd_, 0, sizeof(cmd_));
  }

  void publish(uint8_t cmd) {
    using namespace displayframe;
    const Status s = {VERSION, FW_VER, bootId_, seq_, state_, err_};
    uint8_t bytes[STATUS_LEN];
    encodeStatus(s, bytes);
    board_.lock();
    memcpy(status_, bytes, sizeof(status_));
    board_.unlock();
    board_.preload(bytes);
    board_.log(cmd, seq_, state_, err_);
  }

  CydBoard& board_;
  const uint32_t bootId_;

  // Shared with the I2C task, under board_.lock().
  uint8_t box_[displayframe::MAX_FRAME] = {};
  size_t boxLen_ = 0;
  bool boxFull_ = false;
  uint32_t rxMs_ = 0;  // last write from the hub
  uint8_t status_[displayframe::STATUS_LEN] = {};

  // Main loop only. frame_ and cmd_ hold a token only while a challenge is being drawn.
  uint8_t frame_[displayframe::MAX_FRAME] = {};
  displayframe::Command cmd_ = {};
  bool handled_ = false;
  uint32_t handledSeq_ = 0;
  uint32_t seq_ = 0;
  uint8_t state_ = displayframe::IDLE;
  uint8_t err_ = displayframe::NONE;
  Screen screen_ = HOME;
  uint32_t deadline_ = 0;
};

}  // namespace aegis
