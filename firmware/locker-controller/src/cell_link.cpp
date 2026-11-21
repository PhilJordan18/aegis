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

void CellLink::set(Status status, const char* why) {
  if (status == status_) return;
  status_ = status;
  char line[96];
  snprintf(line, sizeof(line), "cell %u: %s (%s)", expected_, connectionStatus(), why);
  platform_.log(line);
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
  }
  bootKnown_ = true;
  bootId_ = reply.bootId;
  set(Status::Connected, "answered");
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
    uint32_t pingSeq;
    if (cellframe::parsePing(reader_.buf, &pingSeq)) continue;  // our own PING echoed by the transceiver
    cellframe::Reply reply;
    if (!cellframe::parseReply(reader_.buf, &reply)) continue;
    // An answer to an earlier PING never counts. The current one is read before the timeout
    // is checked, so a main loop briefly held by an MQTT publish does not turn it into a miss.
    if (!waiting_ || reply.seq != seq_) continue;
    onReply(reply);
  }
}

void CellLink::loop() {
  const uint32_t now = platform_.nowMs();
  readPort();

  if (waiting_ && due(now, sentMs_ + CELL_REPLY_TIMEOUT_MS)) onMiss();

  if (!waiting_ && (!started_ || due(now, nextPollMs_))) {
    started_ = true;
    char frame[cellframe::MAX_LINE];
    size_t n = cellframe::encodePing(++seq_, frame, sizeof(frame));
    port_.write(frame, n);
    waiting_ = true;
    sentMs_ = now;
    nextPollMs_ = now + CELL_POLL_INTERVAL_MS;
  }
}

}  // namespace aegis
