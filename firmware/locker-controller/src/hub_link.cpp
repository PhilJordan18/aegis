#include "hub_link.h"

#include <cstdio>
#include <cstring>

#include "backoff.h"
#include "contract.h"

namespace aegis {

namespace {

// Wrap-safe: true once `now` has reached `deadline`.
bool due(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }

}  // namespace

HubLink::HubLink(const HubConfig& config, Transport& transport, Platform& platform)
    : config_(config), transport_(transport), platform_(platform), inbox_(config, platform) {
  snprintf(commandsTopic_, sizeof(commandsTopic_), "aegis/v1/lockers/%s/commands", config.lockerId);
  snprintf(displayTopic_, sizeof(displayTopic_), "aegis/v1/lockers/%s/display", config.lockerId);
}

bool HubLink::begin() {
  if (!platform_.incrementBootCount(&bootCount_)) {
    platform_.log("boot counter not persisted, staying offline");
    state_ = State::Halted;
    return false;
  }
  inbox_.load();
  platform_.newUuid(deviceSessionId_);
  bootMs_ = platform_.nowMs();
  nextSequence_ = 0;
  restartedPending_ = true;
  state_ = State::WaitingForNetwork;
  return true;
}

void HubLink::fill(EnvelopeBuf* buf) {
  platform_.newUuid(buf->messageId);
  formatInstant(platform_.unixSeconds(), buf->timestamp);
  buf->env = Envelope{config_.lockerId, buf->messageId, buf->timestamp, deviceSessionId_, bootCount_, nextSequence_++};
}

// The clock must be synchronized before ONLINE (doc 10 §15.1, §17.1).
bool HubLink::ready() { return platform_.networkUp() && platform_.clockSynchronized(); }

void HubLink::startConnect(uint32_t now) {
  platform_.newUuid(connectionId_);

  // The Will is prepared for this attempt only: new messageId, connectionId and sequence (§15.2).
  EnvelopeBuf buf;
  Message will;
  fill(&buf);
  if (!buildAvailability(&will, buf.env, connectionId_, false, "CONNECTION_LOST")) {
    platform_.log("Last Will does not fit, staying offline");
    state_ = State::Halted;
    return;
  }
  transport_.connect(will);
  connectStartMs_ = now;
  state_ = State::Connecting;
}

void HubLink::onConnected(uint32_t now) {
  attempt_ = 0;

  EnvelopeBuf buf;
  Message online;
  fill(&buf);
  if (!buildAvailability(&online, buf.env, connectionId_, true, nullptr) || !transport_.publish(online)) {
    platform_.log("ONLINE not published, dropping the connection");
    transport_.abort();
    scheduleReconnect(now);
    return;
  }
  // Subscribed on every connection: cleanSession=false keeps it, but the broker may have lost it (§7.1).
  if (!transport_.subscribe(commandsTopic_, 1) || (display_ != nullptr && !transport_.subscribe(displayTopic_, 1))) {
    platform_.log("commands or display subscription refused, dropping the connection");
    transport_.abort();
    scheduleReconnect(now);
    return;
  }
  state_ = State::Online;
  tryPublishRestarted();
  publishHeartbeat(now);
  reportUncertain();
}

void HubLink::scheduleReconnect(uint32_t now) {
  retryAtMs_ = now + reconnectDelayMs(attempt_++, platform_.random(1001));
  state_ = State::Backoff;
}

// Once per boot, after the ONLINE of the first connection (§13.1). Retried at the next
// heartbeat if the client refused it, and never repeated after a reconnection.
void HubLink::tryPublishRestarted() {
  if (!restartedPending_) return;
  EnvelopeBuf buf;
  Message restarted;
  fill(&buf);
  if (buildDeviceRestarted(&restarted, buf.env, platform_.resetReason(), config_.firmwareVersion) &&
      transport_.publish(restarted)) {
    restartedPending_ = false;
  }
}

void HubLink::publishHeartbeat(uint32_t now) {
  nextHeartbeatMs_ = now + HEARTBEAT_INTERVAL_MS;

  // No door sensor is read yet, so doorState stays UNKNOWN rather than guessed (§12.2).
  CompartmentFacts compartments[MAX_COMPARTMENTS];
  size_t count = config_.compartmentCount < MAX_COMPARTMENTS ? config_.compartmentCount : MAX_COMPARTMENTS;
  for (size_t i = 0; i < count; i++) {
    const int address = config_.compartments[i].cellAddress;
    const CellObservation cell =
        cellStatus_ != nullptr ? cellStatus_(address) : CellObservation{"UNKNOWN", "UNKNOWN", "UNKNOWN"};
    compartments[i] = CompartmentFacts{config_.compartments[i].compartmentId, address, cell.connectionStatus,
                                       cell.readerStatus, "UNKNOWN", cell.lockState};
  }

  EnvelopeBuf buf;
  Message heartbeat;
  fill(&buf);
  HeartbeatFacts facts{connectionId_, config_.firmwareVersion, (now - bootMs_) / 1000,
                       platform_.clockSynchronized(), platform_.rssiDbm(), compartments, count};
  if (buildHeartbeat(&heartbeat, buf.env, facts)) transport_.publish(heartbeat);
}

bool HubLink::publishScan(int cellAddress, const ScanResult& scan) {
  if (state_ != State::Online) return false;
  const char* compartmentId = nullptr;
  for (size_t i = 0; i < config_.compartmentCount; i++) {
    if (config_.compartments[i].cellAddress == cellAddress) compartmentId = config_.compartments[i].compartmentId;
  }
  if (compartmentId == nullptr) return false;

  // The window was timed on the monotonic clock; its instants are counted back from now.
  const uint32_t now = platform_.nowMs();
  const int64_t unixNow = platform_.unixSeconds();
  char startedAt[INSTANT_LEN], endedAt[INSTANT_LEN];
  formatInstant(unixNow - static_cast<int64_t>((now - scan.startedMs) / 1000), startedAt);
  formatInstant(unixNow - static_cast<int64_t>((now - scan.endedMs) / 1000), endedAt);

  ObservedTag tags[cellframe::MAX_SCAN_TAGS];
  size_t count = scan.tagCount < cellframe::MAX_SCAN_TAGS ? scan.tagCount : cellframe::MAX_SCAN_TAGS;
  for (size_t i = 0; i < count; i++) tags[i] = ObservedTag{scan.tags[i].epc, scan.tags[i].readCount};

  EnvelopeBuf buf;
  fill(&buf);
  if (!buildRfidScanCompleted(&outbound_, buf.env, compartmentId, startedAt, endedAt,
                              cellframe::readerStatusName(scan.reader), tags, count)) {
    platform_.log("RFID scan does not fit, dropped");
    return false;
  }
  return transport_.publish(outbound_);
}

void HubLink::publishAck(const char* commandMessageId, const char* operationId, const char* compartmentId,
                         const char* result) {
  EnvelopeBuf buf;
  Message m;
  fill(&buf);
  if (buildCommandAck(&m, buf.env, commandMessageId, operationId, compartmentId, result)) transport_.publish(m);
}

void HubLink::publishRejected(const char* commandMessageId, const char* operationId, const char* compartmentId,
                              Reason reason) {
  EnvelopeBuf buf;
  Message m;
  fill(&buf);
  if (buildCommandRejected(&m, buf.env, commandMessageId, operationId, compartmentId, reasonName(reason),
                           reasonDetail(reason))) {
    transport_.publish(m);
  }
}

// A duplicate gets the known result again, never a new actuation (§10.1).
void HubLink::publishKnown(const InboundResult& r) {
  const JournalEntry& e = r.known;
  const Command& c = r.command;
  // Same messageId: the journaled command's own ids. New messageId for a consumed operation: the
  // known result on the same cell, INVALID_PAYLOAD on another (§9.1).
  const bool otherCell = r.viaOperation && strcmp(e.compartmentId, c.compartmentId) != 0;
  if (otherCell) {
    publishRejected(c.messageId, c.operationId, c.compartmentId, Reason::InvalidPayload);
    return;
  }
  const char* commandId = r.viaOperation ? c.messageId : e.messageId;
  if (e.state == CommandState::Acknowledged) {
    publishAck(commandId, e.operationId, e.compartmentId, "ALREADY_APPLIED");
  } else {
    Reason reason = e.state == CommandState::Executing ? Reason::PreviousExecutionUncertain : e.reason;
    publishRejected(commandId, e.operationId, e.compartmentId, reason);
  }
}

// `which`: 0 retained, 1 uncorrelable. At most one report per case and 60 s; the next one
// counts what was not reported in between (§13.2).
void HubLink::reportInvalid(size_t which, const char* compartmentId, uint32_t now, const char* channel) {
  Limiter& l = limiter_[which];
  if (l.reported && !due(now, l.lastMs + INBOUND_REPORT_WINDOW_MS)) {
    l.unreported++;
    return;
  }
  char detail[200];
  snprintf(detail, sizeof(detail),
           "A %s %s message was ignored: neither executed, displayed nor journaled.",
           which == 0 ? "retained" : "uncorrelable", channel);
  size_t n = strlen(detail);
  if (l.unreported > 0) snprintf(detail + n, sizeof(detail) - n, " Not reported since the previous report: %lu.", static_cast<unsigned long>(l.unreported));
  EnvelopeBuf buf;
  Message m;
  fill(&buf);
  if (buildInboundInvalid(&m, buf.env, compartmentId, detail) && transport_.publish(m)) {
    l.reported = true;
    l.lastMs = now;
    l.unreported = 0;
  } else {
    l.unreported++;
  }
}

// A command left EXECUTING by a restart is reported once, as a rejection (§9.1).
void HubLink::reportUncertain() {
  while (const JournalEntry* e = inbox_.nextUncertain()) {
    EnvelopeBuf buf;
    Message m;
    fill(&buf);
    if (!buildCommandRejected(&m, buf.env, e->messageId, e->operationId, e->compartmentId,
                              reasonName(Reason::PreviousExecutionUncertain),
                              reasonDetail(Reason::PreviousExecutionUncertain)) ||
        !transport_.publish(m)) {
      return;  // retried at the next heartbeat
    }
    inbox_.markReported(*e);
  }
}

void HubLink::execute(const Command& c) {
  // shortcut: with no handler nothing is journaled, so the same command is refused again each time.
  if (handler_ == nullptr || !inbox_.begin(c, platform_.unixSeconds())) {
    publishRejected(c.messageId, c.operationId, c.compartmentId, Reason::InternalDeviceError);
    return;
  }
  const bool ok = handler_(c);
  inbox_.finish(c, ok);
  if (ok) {
    publishAck(c.messageId, c.operationId, c.compartmentId, "ACCEPTED");
  } else {
    publishRejected(c.messageId, c.operationId, c.compartmentId, Reason::LockActuationFailed);
  }
}

void HubLink::handleDisplay(uint32_t now) {
  DisplayResult r = display_->accept(inbound_, deviceSessionId_, platform_.unixSeconds(), platform_.clockSynchronized());
  DisplayResult replaced;
  while (display_->poll(&replaced)) answerDisplay(replaced, now);  // an instruction this one superseded
  answerDisplay(r, now);
}

void HubLink::answerDisplay(const DisplayResult& r, uint32_t now) {
  const DisplayInstruction& in = r.instruction;
  const char* cell = r.compartmentKnown ? in.compartmentId : nullptr;
  EnvelopeBuf buf;
  Message m;
  switch (r.kind) {
    case DisplayInbound::Ignored:
    case DisplayInbound::Pending:
    case DisplayInbound::Shown:
      return;
    case DisplayInbound::Retained: reportInvalid(0, cell, now, "display"); return;
    case DisplayInbound::Uncorrelable: reportInvalid(1, cell, now, "display"); return;
    case DisplayInbound::Displayed:
      fill(&buf);
      if (buildChallengeDisplayed(&m, buf.env, in.operationId, in.compartmentId, in.messageId, in.challengeId,
                                  in.revision)) {
        transport_.publish(m);
      }
      return;
    case DisplayInbound::Rejected:
      fill(&buf);
      if (buildDisplayRejected(&m, buf.env, in.operationId, in.compartmentId, in.messageId,
                               in.challenge && in.challengeId[0] != '\0' ? in.challengeId : nullptr, in.revision,
                               displayReasonName(r.reason))) {
        transport_.publish(m);
      }
      return;
  }
}

void HubLink::connectionLost() {
  if (display_ != nullptr) display_->connectionLost();
}

void HubLink::handleInbound() {
  while (transport_.pollMessage(&inbound_)) {
    const uint32_t now = platform_.nowMs();
    if (display_ != nullptr && strcmp(inbound_.topic, displayTopic_) == 0) {
      handleDisplay(now);
      continue;
    }
    if (strcmp(inbound_.topic, commandsTopic_) != 0) continue;
    InboundResult r = inbox_.accept(inbound_, platform_.unixSeconds(), platform_.clockSynchronized());
    const char* cell = r.compartmentKnown ? r.command.compartmentId : nullptr;
    switch (r.kind) {
      case Inbound::Retained: reportInvalid(0, cell, now, "commands"); break;
      case Inbound::Uncorrelable: reportInvalid(1, cell, now, "commands"); break;
      case Inbound::Rejected:
        publishRejected(r.command.messageId, r.command.operationId, r.command.compartmentId, r.reason);
        break;
      case Inbound::Duplicate: publishKnown(r); break;
      case Inbound::Accepted: execute(r.command); break;
    }
  }
}

void HubLink::loop() {
  const uint32_t now = platform_.nowMs();
  // The local deadline holds even offline and without any clearing message (§27.1, §27.3).
  if (display_ != nullptr) {
    display_->loop(platform_.unixSeconds());
    // A draw resolved offline publishes nothing: the known answer goes out on redelivery.
    DisplayResult r;
    while (display_->poll(&r)) {
      if (state_ == State::Online) answerDisplay(r, now);
    }
  }

  switch (state_) {
    case State::NotStarted:
    case State::Halted:
      return;
    case State::WaitingForNetwork:
      if (ready()) startConnect(now);
      return;
    case State::Backoff:
      if (due(now, retryAtMs_)) {
        state_ = State::WaitingForNetwork;
        if (ready()) startConnect(now);
      }
      return;
    case State::Connecting:
    case State::Online:
      break;
  }

  switch (transport_.pollEvent()) {
    case Transport::Event::Connected:
      if (state_ == State::Connecting) onConnected(now);
      break;
    case Transport::Event::Disconnected:
      connectionLost();
      scheduleReconnect(now);
      return;
    case Transport::Event::None:
      break;
  }

  if (state_ == State::Connecting && due(now, connectStartMs_ + CONNECT_TIMEOUT_MS)) {
    transport_.abort();
    scheduleReconnect(now);
    return;
  }
  if (state_ == State::Online) handleInbound();
  if (state_ == State::Online && due(now, nextHeartbeatMs_)) {
    tryPublishRestarted();
    publishHeartbeat(now);
    reportUncertain();
  }
}

}  // namespace aegis
