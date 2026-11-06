#pragma once

#include <cstddef>
#include <cstdint>

#include "hub_config.h"
#include "platform.h"

namespace aegis {

// Controlled reasons of COMMAND_REJECTED (doc 10 §10.2) that this hub can produce.
enum class Reason : uint8_t {
  None,
  InvalidPayload,
  UnsupportedSchema,
  WrongLocker,
  UnknownCompartment,
  ClockNotSynchronized,
  CommandExpired,
  LockActuationFailed,
  PreviousExecutionUncertain,
  InternalDeviceError,
};
const char* reasonName(Reason reason);
const char* reasonDetail(Reason reason);  // fixed diagnostic text, no received value

struct Command {
  char messageId[UUID_LEN];
  char operationId[UUID_LEN];
  char compartmentId[UUID_LEN];
  int64_t expiresAt;  // unix seconds
};

// Local state of a journaled command (§16.1).
enum class CommandState : uint8_t { Free, Executing, Acknowledged, Rejected };

struct JournalEntry {
  char messageId[UUID_LEN];
  char operationId[UUID_LEN];
  char compartmentId[UUID_LEN];
  CommandState state;
  Reason reason;
  int64_t expiresAt;
  int64_t at;    // unix seconds when journaled
  uint32_t seq;  // grows with every write, so the oldest slot is the lowest
};

enum class Inbound {
  Accepted,     // fresh and valid: call begin(), act, then finish()
  Retained,     // §7.2: ignored, never journaled; report INBOUND_MESSAGE_INVALID
  Uncorrelable, // §13.2: unreadable, or an id missing or not a UUID; report INBOUND_MESSAGE_INVALID
  Rejected,     // answer COMMAND_REJECTED with `reason`; already journaled
  Duplicate,    // answer with the result of `known` (§10.1); nothing is actuated
};

struct InboundResult {
  Inbound kind = Inbound::Uncorrelable;
  Reason reason = Reason::None;
  Command command = {};
  bool compartmentKnown = false;  // command.compartmentId is a canonical UUID naming a cell of this hub
  JournalEntry known = {};        // Duplicate only
  bool viaOperation = false;      // Duplicate matched by operationId, not by messageId
};

// Inbound checks of a `commands` message (doc 10 §7.2, §9.1, §16.1, §17.2) and the durable journal
// of consumed commands: a command is persisted as EXECUTING before any actuation, so a redelivery
// or a reboot can never re-trigger the lock.
class CommandInbox {
 public:
  static constexpr size_t CAPACITY = 64;  // §16.1 minimum

  CommandInbox(const HubConfig& config, Platform& platform) : config_(config), platform_(platform) {}

  // Reads the journal; a command left EXECUTING becomes PREVIOUS_EXECUTION_UNCERTAIN and is
  // reported once by nextUncertain().
  void load();
  InboundResult accept(const Message& message, int64_t nowUnix, bool clockSynchronized);
  // Persists EXECUTING. False (no slot, or the write failed) means: do not actuate.
  bool begin(const Command& command, int64_t nowUnix);
  void finish(const Command& command, bool actuated);
  // Uncertain commands whose rejection was not yet published, one per call.
  const JournalEntry* nextUncertain() const;
  void markReported(const JournalEntry& entry);

 private:
  int find(const char* messageId) const;
  int findOperation(const char* operationId) const;
  int slotFor(int64_t nowUnix) const;
  bool store(size_t slot);
  void record(const Command& command, CommandState state, Reason reason, int64_t nowUnix);

  const HubConfig& config_;
  Platform& platform_;
  JournalEntry entries_[CAPACITY] = {};
  bool unreported_[CAPACITY] = {};
  uint32_t seq_ = 0;
};

// "2026-09-16T14:33:00Z" only, as the contract writes instants (§3.2).
bool parseInstant(const char* text, int64_t* unixSeconds);

}  // namespace aegis
