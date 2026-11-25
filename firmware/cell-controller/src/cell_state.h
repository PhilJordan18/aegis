#pragma once

// What a cell observes locally and reports in each REPLY (cell_frame.h): its latch and the health
// of its UHF reader. Plain logic with the time passed in, so tests/host can run it off target.

#include <cstddef>
#include <cstdint>
#include <cstdio>

#include "cell_frame.h"

namespace aegis {
namespace cell {

// ---------------------------------------------------------------- UHF reader (JRD-4035)
// Frame: BB <type> <cmd> <len hi> <len lo> <params...> <checksum> 7E, checksum = low byte of the
// sum from <type> to the last param. Verified on the M5Stack UHF unit (bench uhf-rfid-test, #19).

constexpr uint8_t UHF_HEAD = 0xBB;
constexpr uint8_t UHF_END = 0x7E;
constexpr size_t UHF_MAX_PARAMS = 64;  // a tag notification carries 17; longer frames are dropped
constexpr uint8_t UHF_SINGLE_POLL[] = {0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E};

// Splits the reader's byte stream into frames. push() returns true when `buf` holds a frame whose
// end byte and checksum are right; anything else is skipped until the next head byte.
struct UhfFrameReader {
  uint8_t buf[UHF_MAX_PARAMS + 7] = {};
  size_t len = 0;
  size_t need = 0;  // full frame length once the header is in, 0 before

  bool push(uint8_t b) {
    if (len == 0 && b != UHF_HEAD) return false;
    buf[len++] = b;
    if (len == 5) {
      size_t params = (static_cast<size_t>(buf[3]) << 8) | buf[4];
      if (params > UHF_MAX_PARAMS) {
        len = 0;
        return false;
      }
      need = params + 7;
    }
    if (need == 0 || len < need) return false;
    len = 0;
    need = 0;
    return valid();
  }

 private:
  bool valid() const {
    size_t n = ((static_cast<size_t>(buf[3]) << 8) | buf[4]) + 7;
    uint8_t sum = 0;
    for (size_t i = 1; i < n - 2; i++) sum = static_cast<uint8_t>(sum + buf[i]);
    return buf[n - 1] == UHF_END && buf[n - 2] == sum;
  }
};

// EPC of a tag notification (type 02, command 22): RSSI, PC (2), EPC, CRC (2). False for any other frame.
inline bool tagEpc(const UhfFrameReader& r, const uint8_t** epc, size_t* len) {
  size_t params = (static_cast<size_t>(r.buf[3]) << 8) | r.buf[4];
  if (r.buf[1] != 0x02 || r.buf[2] != 0x22 || params < 6 || params - 5 > cellframe::MAX_EPC_BYTES) return false;
  *epc = r.buf + 5 + 3;
  *len = params - 5;
  return true;
}

// Reader health from its answers. The cell sends a single poll every READER_POLL_MS; the reader
// answers every poll with a tag notification or a "no tag" error frame, so any valid frame proves
// it is alive. HEALTHY after a valid frame, FAULTED after READER_FAULT_AFTER polls in a row with
// none, UNKNOWN before either. Provisional values until PHY-02 (#31) sets reader health rules.
constexpr uint32_t READER_POLL_MS = 1000;
constexpr uint32_t READER_FAULT_AFTER = 3;

class ReaderHealth {
 public:
  // True when a poll is due; the caller then writes UHF_SINGLE_POLL.
  bool pollDue(uint32_t now) {
    if (started_ && static_cast<int32_t>(now - nextPollMs_) < 0) return false;
    started_ = true;
    nextPollMs_ = now + READER_POLL_MS;
    if (unanswered_ < READER_FAULT_AFTER) unanswered_++;
    return true;
  }
  void onValidFrame() {
    unanswered_ = 0;
    seen_ = true;
  }
  char status() const {
    if (unanswered_ >= READER_FAULT_AFTER) return cellframe::READER_FAULTED;
    return seen_ ? cellframe::READER_HEALTHY : cellframe::STATE_UNKNOWN;
  }

 private:
  bool started_ = false;
  uint32_t nextPollMs_ = 0;
  uint32_t unanswered_ = 0;  // polls sent since the last valid frame, capped
  bool seen_ = false;
};

// ---------------------------------------------------------------- scan window (FW-02)
// POC-01 thresholds (#19): a 3 s window, one single poll every 100 ms. The window is HEALTHY when
// the reader answered at least SCAN_MIN_ANSWERED of its polls, FAULTED when it answered none,
// UNKNOWN otherwise; more than MAX_SCAN_TAGS distinct tags also make it UNKNOWN, since a tag
// left out would read as absent. "Present" (>= 3 reads) is decided by the backend (doc 10 §12.2).
constexpr uint32_t SCAN_WINDOW_MS = 3000;
constexpr uint32_t SCAN_POLL_MS = 100;
constexpr uint32_t SCAN_MIN_ANSWERED = 27;  // of 30 polls; provisional until PHY-02 (#31)

class ScanWindow {
 public:
  void start(uint32_t now) {
    state_ = cellframe::SCAN_RUNNING;
    startMs_ = now;
    nextPollMs_ = now;
    polls_ = answered_ = 0;
    pollAnswered_ = false;
    count_ = 0;
    overflow_ = false;
  }
  // True when a poll is due now; the caller then writes UHF_SINGLE_POLL. Also ends the window.
  bool pollDue(uint32_t now) {
    if (state_ != cellframe::SCAN_RUNNING) return false;
    if (static_cast<int32_t>(now - (startMs_ + SCAN_WINDOW_MS)) >= 0) {
      closePoll();
      state_ = cellframe::SCAN_DONE;
      return false;
    }
    if (static_cast<int32_t>(now - nextPollMs_) < 0) return false;
    closePoll();
    polls_++;
    nextPollMs_ += SCAN_POLL_MS;
    return true;
  }
  void onValidFrame() {
    if (state_ == cellframe::SCAN_RUNNING) pollAnswered_ = true;
  }
  void onTag(const uint8_t* epc, size_t len) {
    if (state_ != cellframe::SCAN_RUNNING) return;
    char hex[cellframe::MAX_EPC_BYTES * 2 + 1];
    for (size_t i = 0; i < len; i++) snprintf(hex + 2 * i, 3, "%02X", epc[i]);
    hex[2 * len] = '\0';
    for (size_t i = 0; i < count_; i++) {
      if (strcmp(tags_[i].epc, hex) == 0) {
        if (tags_[i].readCount < 65535) tags_[i].readCount++;
        return;
      }
    }
    if (count_ == cellframe::MAX_SCAN_TAGS) {
      overflow_ = true;
      return;
    }
    memcpy(tags_[count_].epc, hex, 2 * len + 1);
    tags_[count_].readCount = 1;
    count_++;
  }

  char state() const { return state_; }
  uint8_t tagCount() const { return state_ == cellframe::SCAN_DONE ? static_cast<uint8_t>(count_) : 0; }
  char reader() const {
    if (state_ != cellframe::SCAN_DONE) return cellframe::NO_WINDOW;
    if (overflow_) return cellframe::STATE_UNKNOWN;
    if (answered_ >= SCAN_MIN_ANSWERED) return cellframe::READER_HEALTHY;
    return answered_ == 0 ? cellframe::READER_FAULTED : cellframe::STATE_UNKNOWN;
  }
  const cellframe::Tag* tag(uint8_t index) const {
    return state_ == cellframe::SCAN_DONE && index < count_ ? &tags_[index] : nullptr;
  }

 private:
  void closePoll() {
    if (polls_ > 0 && pollAnswered_) answered_++;
    pollAnswered_ = false;
  }

  char state_ = cellframe::SCAN_NONE;
  uint32_t startMs_ = 0;
  uint32_t nextPollMs_ = 0;
  uint32_t polls_ = 0;
  uint32_t answered_ = 0;
  bool pollAnswered_ = false;
  cellframe::Tag tags_[cellframe::MAX_SCAN_TAGS];
  size_t count_ = 0;
  bool overflow_ = false;
};

// ---------------------------------------------------------------- latch status switch
// The Sutertech rotary latch's white/yellow switch, read with a pull-up. POC-03 L0 (#21): the
// contact is open while the striker is held, closed once it is out. A broken switch wire also
// reads open, so a cut wire reports LOCKED: the dry contact cannot tell the two apart.
constexpr uint32_t LATCH_DEBOUNCE_MS = 30;

class LatchSwitch {
 public:
  // `contactClosed` is the raw reading (pin LOW with the pull-up).
  void begin(bool contactClosed) {
    stable_ = raw_ = contactClosed;
    known_ = true;
  }
  void sample(bool contactClosed, uint32_t now) {
    if (!known_) {
      begin(contactClosed);
      return;
    }
    if (contactClosed != raw_) {
      raw_ = contactClosed;
      sinceMs_ = now;
    }
    if (raw_ != stable_ && now - sinceMs_ >= LATCH_DEBOUNCE_MS) stable_ = raw_;
  }
  char state() const {
    if (!known_) return cellframe::STATE_UNKNOWN;
    return stable_ ? cellframe::LOCK_UNLOCKED : cellframe::LOCK_LOCKED;
  }

 private:
  bool known_ = false;
  bool stable_ = false;
  bool raw_ = false;
  uint32_t sinceMs_ = 0;
};

}  // namespace cell
}  // namespace aegis
