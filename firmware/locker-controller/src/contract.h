#pragma once

#include <cstdint>

namespace aegis {

// Constants re-read from docs/cahier-conception/10-contrats-mqtt.md (schema 3.0).
// They are deliberately not shared with the API or the hub simulator, so a divergence
// between the readings of the contract shows up in integration.

constexpr const char* SCHEMA_VERSION = "3.0";  // §3.2
constexpr uint32_t KEEPALIVE_SECONDS = 30;     // §7.1
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 10000;  // §14
constexpr uint32_t RECONNECT_BASE_MS = 1000;   // §18
constexpr uint32_t RECONNECT_MAX_MS = 30000;   // §18
// Not in the contract: bounds an attempt that neither connects nor reports an error.
constexpr uint32_t CONNECT_TIMEOUT_MS = 15000;

}  // namespace aegis
