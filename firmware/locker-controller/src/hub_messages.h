#pragma once

#include <cstddef>
#include <cstdint>

#include "platform.h"

namespace aegis {

// Common envelope of every hub message (doc 10 §8.1). The strings are owned by the
// caller and must outlive the build call.
struct Envelope {
  const char* lockerId;
  const char* messageId;
  const char* timestamp;  // "2026-09-16T14:31:10Z"
  const char* deviceSessionId;
  uint32_t bootCount;
  uint32_t sequence;
};

struct CompartmentFacts {
  const char* compartmentId;
  int cellAddress;
  const char* connectionStatus;  // CONNECTED, DISCONNECTED or UNKNOWN
  const char* readerStatus;      // HEALTHY, FAULTED or UNKNOWN
  const char* doorState;         // OPEN, CLOSED or UNKNOWN
  const char* lockState;         // LOCKED, UNLOCKED or UNKNOWN
};

struct HeartbeatFacts {
  const char* connectionId;
  const char* firmwareVersion;
  uint32_t uptimeSeconds;
  bool clockSynchronized;
  int rssiDbm;
  const CompartmentFacts* compartments;
  size_t compartmentCount;
};

// Every string inserted into a payload is a UUID, an instant or a controlled constant,
// so none needs JSON escaping. Each builder returns false when the payload does not fit.

void formatInstant(int64_t unixSeconds, char out[INSTANT_LEN]);

// Doc 10 §15: status ONLINE with reason CONNECTED, or OFFLINE with CONNECTION_LOST
// (the Last Will) or SHUTDOWN. ONLINE and OFFLINE are published on `status`, QoS 1, retained.
bool buildAvailability(Message* out, const Envelope& env, const char* connectionId, bool online,
                       const char* offlineReason);

// Doc 10 §13.1, on `events`, QoS 1, not retained.
bool buildDeviceRestarted(Message* out, const Envelope& env, const char* resetReason, const char* firmwareVersion);

// Doc 10 §14, on `status`, QoS 0, not retained.
bool buildHeartbeat(Message* out, const Envelope& env, const HeartbeatFacts& facts);

}  // namespace aegis
