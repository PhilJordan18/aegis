#pragma once

#include <cstdint>

#include "cell_frame.h"
#include "platform.h"

namespace aegis {

// Poll schedule of one segment. At 115200 baud a REPLY takes about 3.4 ms on the wire; the bench
// (issue #20) measured 5.2 ms average and 5.7 ms worst from PING to parsed REPLY with frame v1.
constexpr uint32_t CELL_POLL_INTERVAL_MS = 100;
constexpr uint32_t CELL_REPLY_TIMEOUT_MS = 30;
constexpr uint32_t CELL_ABSENT_AFTER_MISSES = 3;

// RFID scans of one cell (FW-02): one when its latch goes from UNLOCKED to LOCKED (no door sensor
// yet, so the latch closing stands in for the door closing, doc 10 §12.1), and one every
// CELL_SCAN_INTERVAL_MS to monitor the cell outside any operation (§20).
constexpr uint32_t CELL_SCAN_INTERVAL_MS = 30000;
// A window lasts 3 s on the cell (POC-01, #19); past this the hub gives up on it.
constexpr uint32_t CELL_SCAN_GIVE_UP_MS = 6000;

// A finished window, with the hub's monotonic times of its start and end.
struct ScanResult {
  uint32_t startedMs = 0;
  uint32_t endedMs = 0;
  char reader = cellframe::STATE_UNKNOWN;  // H, F or ?
  uint8_t tagCount = 0;
  cellframe::Tag tags[cellframe::MAX_SCAN_TAGS];
};

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
  // What the cell reported in its last counted answer, as doc 10 §14 values. UNKNOWN whenever the
  // link is not CONNECTED: a silent or foreign cell's latch and reader are never guessed.
  const char* lockState() const;
  const char* readerStatus() const;
  uint8_t expectedAddress() const { return expected_; }
  // True once, with the result, when a scan window has finished and all its tags were fetched.
  bool takeScan(ScanResult* out);

 private:
  enum class Status { Unknown, Connected, Disconnected };
  enum class Scan { Idle, Requested, Running, Fetching, Ready };

  void readPort();
  void onReply(const cellframe::Reply& reply);
  void onTag(uint8_t index, const cellframe::Tag& tag);
  void onMiss();
  void set(Status status, const char* why);
  void trackScan(const cellframe::Reply& reply);
  void abandonScan(const char* why);
  void sendPoll(uint32_t now);

  const uint8_t expected_;
  CellPort& port_;
  Platform& platform_;
  cellframe::LineReader reader_;

  Status status_ = Status::Unknown;
  uint32_t seq_ = 0;
  char sentKind_ = 'P';  // P, S or T: what the pending poll asked
  bool waiting_ = false;
  uint32_t sentMs_ = 0;
  uint32_t nextPollMs_ = 0;
  bool started_ = false;
  uint32_t misses_ = 0;
  bool bootKnown_ = false;
  uint32_t bootId_ = 0;
  char lock_ = cellframe::STATE_UNKNOWN;
  char readerHealth_ = cellframe::STATE_UNKNOWN;
  int wrongAddressLogged_ = -1;  // the foreign address last logged, -1 when none

  Scan scan_ = Scan::Idle;
  bool scanEver_ = false;
  bool latchClosed_ = false;  // the latch went UNLOCKED -> LOCKED since the last scan request
  uint32_t lastScanMs_ = 0;
  uint8_t fetchIndex_ = 0;
  ScanResult result_;
};

}  // namespace aegis
