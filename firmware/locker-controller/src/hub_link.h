#pragma once

#include <cstddef>
#include <cstdint>

#include "hub_messages.h"
#include "platform.h"

namespace aegis {

constexpr size_t MAX_COMPARTMENTS = 4;

struct CompartmentConfig {
  const char* compartmentId;
  int cellAddress;
};

struct HubConfig {
  const char* lockerId;
  const char* firmwareVersion;
  const CompartmentConfig* compartments;
  size_t compartmentCount;
};

// Connection lifecycle of the hub toward the broker (doc 10 §7, §13.1, §14, §15, §18):
// a fresh Last Will and connectionId before every attempt, ONLINE, then DEVICE_RESTARTED
// once per boot, then a heartbeat now and every 10 s, and a backoff between attempts.
// It does not subscribe yet: commands and display arrive with later slices.
class HubLink {
 public:
  enum class State { NotStarted, Halted, WaitingForNetwork, Connecting, Online, Backoff };

  HubLink(const HubConfig& config, Transport& transport, Platform& platform);

  // Persists the boot counter before anything is published. False leaves the hub
  // offline rather than reusing a counter value (doc 10 §8.1).
  bool begin();
  // Call often from the main loop; it never blocks.
  void loop();
  State state() const { return state_; }

 private:
  struct EnvelopeBuf {
    char messageId[UUID_LEN];
    char timestamp[INSTANT_LEN];
    Envelope env;
  };

  void fill(EnvelopeBuf* buf);
  void startConnect(uint32_t now);
  void onConnected(uint32_t now);
  void scheduleReconnect(uint32_t now);
  void tryPublishRestarted();
  void publishHeartbeat(uint32_t now);
  bool ready();

  const HubConfig& config_;
  Transport& transport_;
  Platform& platform_;

  State state_ = State::NotStarted;
  char deviceSessionId_[UUID_LEN] = {};
  char connectionId_[UUID_LEN] = {};
  uint32_t bootCount_ = 0;
  uint32_t nextSequence_ = 0;
  uint32_t bootMs_ = 0;
  uint32_t attempt_ = 0;
  uint32_t retryAtMs_ = 0;
  uint32_t connectStartMs_ = 0;
  uint32_t nextHeartbeatMs_ = 0;
  bool restartedPending_ = true;
};

}  // namespace aegis
