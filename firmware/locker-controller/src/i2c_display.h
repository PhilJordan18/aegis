#pragma once

#include <cstddef>
#include <cstdint>

#include "display_frame.h"
#include "display_inbox.h"
#include "platform.h"

namespace aegis {

// The hub's screen: the CYD display node, an I2C slave (frame in display_frame.h). show*() only
// encodes the frame; loop() does the bus work, at most one transaction per call, and never waits.
// A show is Drawn only when the CYD reports SHOWN for the seq we sent.
class I2cDisplay : public Display {
 public:
  static constexpr uint32_t DRAW_TIMEOUT_MS = 1000;
  static constexpr uint32_t SILENCE_MS = 3000;     // available() turns false after this without a status
  static constexpr uint32_t IDLE_PERIOD_MS = 1000; // PING then status read
  static constexpr uint32_t DRAW_POLL_MS = 20;     // status read while a draw is pending
  static constexpr uint8_t MAX_WRITES = 3;
  static constexpr uint8_t FAILURES_BEFORE_RESET = 5;
  static constexpr uint32_t RESET_MIN_GAP_MS = 5000;

  I2cDisplay(I2cBus& bus, Platform& platform, uint8_t address) : bus_(bus), platform_(platform), address_(address) {}

  bool available() override;
  bool showChallenge(const char* uri, const char* action, const char* compartmentCode, uint16_t ttlMs) override;
  bool showStatus(const char* action, const char* compartmentCode, const char* status, uint16_t ttlMs) override;
  void clear() override;
  DrawState drawState() override { return state_; }
  // Call often from the main loop.
  void loop();

 private:
  bool show(uint8_t cmd, const char* text, const char* action, const char* compartmentCode, uint16_t ttlMs);
  bool queue(displayframe::Command& c);
  void drop();
  void fail(const char* what);
  void readStatus(uint32_t now);
  void log(const char* what, uint8_t cmd, uint32_t seq, uint8_t err);

  I2cBus& bus_;
  Platform& platform_;
  const uint8_t address_;

  // The one frame in flight. It holds the token of a challenge until the draw is resolved (the
  // BAD_CRC resend needs it), at most DRAW_TIMEOUT_MS after the write; then it is zeroed.
  uint8_t frame_[displayframe::MAX_FRAME] = {};
  size_t frameLen_ = 0;
  uint8_t cmd_ = 0;
  uint32_t seq_ = 0;
  bool seeded_ = false;
  bool toWrite_ = false;
  uint8_t writes_ = 0;
  bool resent_ = false;
  bool readNext_ = false;   // read the status right after an idle PING
  bool awaiting_ = false;   // show written, waiting for SHOWN
  DrawState state_ = DrawState::Idle;
  uint32_t submittedMs_ = 0;
  uint32_t nextReadMs_ = 0;
  uint32_t nextIdleMs_ = 0;

  bool heard_ = false;
  uint32_t lastStatusMs_ = 0;
  bool bootKnown_ = false;
  uint32_t bootId_ = 0;

  uint8_t failures_ = 0;
  bool everReset_ = false;
  uint32_t lastResetMs_ = 0;
};

}  // namespace aegis
