#include "cell_link.h"

#include <cstdio>

namespace aegis {

namespace {

bool due(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }

}  // namespace

CellLink::CellLink(uint8_t expectedAddress, CellPort& port, Platform& platform)
    : expected_(expectedAddress), port_(port), platform_(platform) {}

const char* CellLink::connectionStatus() const {
  switch (status_) {
    case Status::Connected: return "CONNECTED";
    case Status::Disconnected: return "DISCONNECTED";
    case Status::Unknown: break;
  }
  return "UNKNOWN";
}

const char* CellLink::lockState() const {
  return cellframe::lockStateName(status_ == Status::Connected ? lock_ : cellframe::STATE_UNKNOWN);
}

const char* CellLink::readerStatus() const {
  return cellframe::readerStatusName(status_ == Status::Connected ? readerHealth_ : cellframe::STATE_UNKNOWN);
}

bool CellLink::takeScan(ScanResult* out) {
  if (scan_ != Scan::Ready) return false;
  *out = result_;
  scan_ = Scan::Idle;
  return true;
}

void CellLink::set(Status status, const char* why) {
  if (status == status_) return;
  status_ = status;
  if (status != Status::Connected) abandonScan("link lost");
  char line[96];
  snprintf(line, sizeof(line), "cell %u: %s (%s)", expected_, connectionStatus(), why);
  platform_.log(line);
}

void CellLink::abandonScan(const char* why) {
  if (scan_ == Scan::Idle || scan_ == Scan::Ready) return;
  scan_ = Scan::Idle;
  char line[96];
  snprintf(line, sizeof(line), "cell %u: scan abandoned (%s)", expected_, why);
  platform_.log(line);
}

void CellLink::trackScan(const cellframe::Reply& reply) {
  const uint32_t now = platform_.nowMs();
  switch (scan_) {
    case Scan::Requested:
      // The SCAN itself was answered: a running window started at the SCAN, never an older one.
      if (sentKind_ == 'S' && reply.scan == cellframe::SCAN_RUNNING) {
        scan_ = Scan::Running;
        result_ = ScanResult{};
        result_.startedMs = sentMs_;
      }
      break;
    case Scan::Running:
      if (reply.scan == cellframe::SCAN_DONE) {
        result_.endedMs = now;
        result_.reader = reply.scanReader;
        result_.tagCount = reply.tagCount;
        fetchIndex_ = 0;
        scan_ = reply.tagCount == 0 ? Scan::Ready : Scan::Fetching;
      } else if (reply.scan == cellframe::SCAN_NONE) {
        abandonScan("cell lost its window");
      } else if (due(now, result_.startedMs + CELL_SCAN_GIVE_UP_MS)) {
        abandonScan("window too long");
      }
      break;
    case Scan::Fetching:
      if (reply.scan != cellframe::SCAN_DONE) abandonScan("cell lost its window");
      break;
    case Scan::Idle:
    case Scan::Ready:
      break;
  }
}

void CellLink::onReply(const cellframe::Reply& reply) {
  waiting_ = false;
  if (reply.cellAddress != expected_) {
    // Another cell answers on this port: its door and lock must never be reported as ours.
    if (wrongAddressLogged_ != reply.cellAddress) {
      char line[96];
      snprintf(line, sizeof(line), "cell %u: port answered by cell address %u, check the cable", expected_,
               reply.cellAddress);
      platform_.log(line);
      wrongAddressLogged_ = reply.cellAddress;
    }
    misses_ = CELL_ABSENT_AFTER_MISSES;
    set(Status::Disconnected, "wrong cell on this port");
    return;
  }
  wrongAddressLogged_ = -1;
  misses_ = 0;
  if (bootKnown_ && reply.bootId != bootId_) {
    char line[96];
    snprintf(line, sizeof(line), "cell %u: restarted, reset code %u", expected_, reply.resetCode);
    platform_.log(line);
    abandonScan("cell restarted");
  }
  bootKnown_ = true;
  bootId_ = reply.bootId;
  if (reply.lock != lock_ || reply.reader != readerHealth_) {
    char line[96];
    snprintf(line, sizeof(line), "cell %u: lock %s, reader %s", expected_, cellframe::lockStateName(reply.lock),
             cellframe::readerStatusName(reply.reader));
    platform_.log(line);
  }
  if (lock_ == cellframe::LOCK_UNLOCKED && reply.lock == cellframe::LOCK_LOCKED) latchClosed_ = true;
  lock_ = reply.lock;
  readerHealth_ = reply.reader;
  set(Status::Connected, "answered");
  trackScan(reply);
}

void CellLink::onTag(uint8_t index, const cellframe::Tag& tag) {
  waiting_ = false;
  misses_ = 0;
  if (scan_ != Scan::Fetching || index != fetchIndex_) return;
  result_.tags[fetchIndex_++] = tag;
  if (fetchIndex_ >= result_.tagCount) scan_ = Scan::Ready;
}

void CellLink::onMiss() {
  waiting_ = false;
  if (++misses_ >= CELL_ABSENT_AFTER_MISSES) set(Status::Disconnected, "no valid answer");
}

void CellLink::readPort() {
  int byte;
  while ((byte = port_.read()) >= 0) {
    if (!reader_.push(static_cast<char>(byte))) continue;
    if (reader_.overflowed) {
      reader_.clearOverflow();
      continue;
    }
    // A corrupted frame is dropped; the poll then times out and counts as a miss.
    if (!cellframe::unseal(reader_.buf)) continue;
    uint32_t seq;
    uint8_t index, address;
    if (cellframe::parsePing(reader_.buf, &seq) || cellframe::parseScan(reader_.buf, &seq) ||
        cellframe::parseTagRequest(reader_.buf, &seq, &index)) {
      continue;  // our own request echoed by the transceiver
    }
    // An answer to an earlier poll never counts. The current one is read before the timeout
    // is checked, so a main loop briefly held by an MQTT publish does not turn it into a miss.
    cellframe::Reply reply;
    if (cellframe::parseReply(reader_.buf, &reply)) {
      if (waiting_ && reply.seq == seq_ && sentKind_ != 'T') onReply(reply);
      continue;
    }
    cellframe::Tag tag;
    if (cellframe::parseTag(reader_.buf, &seq, &address, &index, &tag) && waiting_ && seq == seq_ &&
        sentKind_ == 'T' && address == expected_) {
      onTag(index, tag);
    }
  }
}

void CellLink::sendPoll(uint32_t now) {
  if (status_ == Status::Connected && scan_ == Scan::Idle &&
      (latchClosed_ || !scanEver_ || due(now, lastScanMs_ + CELL_SCAN_INTERVAL_MS))) {
    scan_ = Scan::Requested;
    scanEver_ = true;
    latchClosed_ = false;
    lastScanMs_ = now;
  }
  char frame[cellframe::MAX_LINE];
  size_t n;
  ++seq_;
  if (scan_ == Scan::Requested) {
    sentKind_ = 'S';
    n = cellframe::encodeScan(seq_, frame, sizeof(frame));
  } else if (scan_ == Scan::Fetching) {
    sentKind_ = 'T';
    n = cellframe::encodeTagRequest(seq_, fetchIndex_, frame, sizeof(frame));
  } else {
    sentKind_ = 'P';
    n = cellframe::encodePing(seq_, frame, sizeof(frame));
  }
  port_.write(frame, n);
  waiting_ = true;
  sentMs_ = now;
  nextPollMs_ = now + CELL_POLL_INTERVAL_MS;
}

void CellLink::loop() {
  const uint32_t now = platform_.nowMs();
  readPort();

  if (waiting_ && due(now, sentMs_ + CELL_REPLY_TIMEOUT_MS)) onMiss();

  if (!waiting_ && (!started_ || due(now, nextPollMs_))) {
    started_ = true;
    sendPoll(now);
  }
}

}  // namespace aegis
