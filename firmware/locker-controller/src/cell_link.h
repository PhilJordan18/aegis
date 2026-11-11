#pragma once

#include <cstdint>

#include "cell_frame.h"
#include "platform.h"

namespace aegis {

// Poll schedule of one segment. At 115200 baud a REPLY takes about 2.7 ms on the wire; the bench
// (issue #20) measured 5.2 ms average and 5.7 ms worst from PING to parsed REPLY.
constexpr uint32_t CELL_POLL_INTERVAL_MS = 100;
constexpr uint32_t CELL_REPLY_TIMEOUT_MS = 30;
constexpr uint32_t CELL_ABSENT_AFTER_MISSES = 3;

// Presence of the cell wired to one hub port. It polls with PING and only counts a REPLY that
// carries the current sequence, a valid CRC and the address expected on this port, so a cable
// plugged into the wrong port never reads as CONNECTED. A lost link is DISCONNECTED, never a
// guess about the cell's door or lock (ADR-002, doc 12 §12).
class CellLink {
 public:
  CellLink(uint8_t expectedAddress, CellPort& port, Platform& platform);

  // Call often from the main loop; it never blocks.
  void loop();
  // UNKNOWN until the first answer or the first absence, then CONNECTED or DISCONNECTED.
  const char* connectionStatus() const;
  uint8_t expectedAddress() const { return expected_; }

 private:
  enum class Status { Unknown, Connected, Disconnected };

  void readPort();
  void onReply(const cellframe::Reply& reply);
  void onMiss();
  void set(Status status, const char* why);

  const uint8_t expected_;
  CellPort& port_;
  Platform& platform_;
  cellframe::LineReader reader_;

  Status status_ = Status::Unknown;
  uint32_t seq_ = 0;
  bool waiting_ = false;
  uint32_t sentMs_ = 0;
  uint32_t nextPollMs_ = 0;
  bool started_ = false;
  uint32_t misses_ = 0;
  bool bootKnown_ = false;
  uint32_t bootId_ = 0;
  int wrongAddressLogged_ = -1;  // the foreign address last logged, -1 when none
};

}  // namespace aegis
