#include "hub_link.h"

#include <cstring>

#include "backoff.h"
#include "contract.h"

namespace aegis {

namespace {

// Wrap-safe: true once `now` has reached `deadline`.
bool due(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }

}  // namespace

HubLink::HubLink(const HubConfig& config, Transport& transport, Platform& platform)
    : config_(config), transport_(transport), platform_(platform) {}

bool HubLink::begin() {
  if (!platform_.incrementBootCount(&bootCount_)) {
    platform_.log("boot counter not persisted, staying offline");
    state_ = State::Halted;
    return false;
  }
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
  state_ = State::Online;
  tryPublishRestarted();
  publishHeartbeat(now);
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

  // No cell bus yet: every cell fact is reported as UNKNOWN rather than guessed (§12.2).
  CompartmentFacts compartments[MAX_COMPARTMENTS];
  size_t count = config_.compartmentCount < MAX_COMPARTMENTS ? config_.compartmentCount : MAX_COMPARTMENTS;
  for (size_t i = 0; i < count; i++) {
    compartments[i] = CompartmentFacts{config_.compartments[i].compartmentId, config_.compartments[i].cellAddress,
                                       "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"};
  }

  EnvelopeBuf buf;
  Message heartbeat;
  fill(&buf);
  HeartbeatFacts facts{connectionId_, config_.firmwareVersion, (now - bootMs_) / 1000,
                       platform_.clockSynchronized(), platform_.rssiDbm(), compartments, count};
  if (buildHeartbeat(&heartbeat, buf.env, facts)) transport_.publish(heartbeat);
}

void HubLink::loop() {
  const uint32_t now = platform_.nowMs();

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
  if (state_ == State::Online && due(now, nextHeartbeatMs_)) {
    tryPublishRestarted();
    publishHeartbeat(now);
  }
}

}  // namespace aegis
