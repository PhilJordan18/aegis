#pragma once

#include <cstddef>
#include <cstdint>

#include "cell_link.h"
#include "command_inbox.h"
#include "display_inbox.h"
#include "hub_config.h"
#include "hub_messages.h"
#include "platform.h"

namespace aegis {

constexpr size_t MAX_COMPARTMENTS = 4;

// Acts on an accepted command; true when the actuation was engaged. It runs only after the
// command is persisted as EXECUTING (doc 10 §9.1, §16.1).
using CommandHandler = bool (*)(const Command&);
// What the hub knows of the cell at one address, as doc 10 §14 values. doorState is not here:
// no cell reads a door sensor yet, so the heartbeat reports it UNKNOWN.
struct CellObservation {
  const char* connectionStatus;  // CONNECTED, DISCONNECTED or UNKNOWN
  const char* readerStatus;      // HEALTHY, FAULTED or UNKNOWN
  const char* lockState;         // LOCKED, UNLOCKED or UNKNOWN
};
using CellStatusSource = CellObservation (*)(int cellAddress);

// Connection lifecycle of the hub toward the broker (doc 10 §7, §13.1, §14, §15, §18):
// a fresh Last Will and connectionId before every attempt, ONLINE, then DEVICE_RESTARTED
// once per boot, then a heartbeat now and every 10 s, and a backoff between attempts.
// Once online it subscribes to its commands topic and hands each command that passes the
// inbound checks of CommandInbox to the handler, and each `display` message to its DisplayInbox.
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
  // Without a handler no command is ever acted on: each one is rejected INTERNAL_DEVICE_ERROR.
  void onCommand(CommandHandler handler) { handler_ = handler; }
  // Without a source every cell is reported UNKNOWN in every field.
  void cellStatus(CellStatusSource source) { cellStatus_ = source; }
  // Publishes a finished scan of the cell at `cellAddress` as RFID_SCAN_COMPLETED, without
  // operationId (§20). False when the hub is not online, the cell is not configured or the
  // payload does not fit; the scan is then dropped, never queued: a missing scan proves nothing (§12.1).
  bool publishScan(int cellAddress, const ScanResult& scan);
  // Subscribes to `display` and hands it to `inbox` (doc 10 §27). Without one, `display` is not read.
  void display(DisplayInbox* inbox) { display_ = inbox; }
  const char* deviceSessionId() const { return deviceSessionId_; }

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
  void handleInbound();
  void handleDisplay(uint32_t now);
  void answerDisplay(const DisplayResult& r, uint32_t now);
  void connectionLost();
  void execute(const Command& command);
  void publishAck(const char* commandMessageId, const char* operationId, const char* compartmentId, const char* result);
  void publishRejected(const char* commandMessageId, const char* operationId, const char* compartmentId,
                       Reason reason);
  void publishKnown(const InboundResult& r);
  void reportInvalid(size_t which, const char* compartmentId, uint32_t now, const char* channel);
  void reportUncertain();
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
  CommandInbox inbox_;
  // INBOUND_MESSAGE_INVALID is limited to one report per case and 60 s, on the monotonic clock (§13.2).
  struct Limiter {
    bool reported = false;
    uint32_t lastMs = 0;
    uint32_t unreported = 0;
  } limiter_[2];
  CommandHandler handler_ = nullptr;
  CellStatusSource cellStatus_ = nullptr;
  DisplayInbox* display_ = nullptr;
  char commandsTopic_[sizeof(Message::topic)] = {};
  char displayTopic_[sizeof(Message::topic)] = {};
  Message inbound_;  // member, not a local: it is 1.6 KB and the loop task stack is small
  Message outbound_;  // the same for a scan, the largest message the hub builds
};

}  // namespace aegis
