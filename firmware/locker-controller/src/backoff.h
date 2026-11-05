#pragma once

#include <algorithm>
#include <cstdint>

#include "contract.h"

namespace aegis {

// Doc 10 §18: 1 s, 2 s, 4 s, 8 s, 16 s, then at most 30 s, with +/-20 % jitter so hubs
// restarted together do not reconnect in lockstep. `attempt` starts at 0 for the first
// retry after a loss; `permille` is a random value from 0 to 1000.
inline uint32_t reconnectDelayMs(uint32_t attempt, uint32_t permille) {
  uint32_t exponent = std::min<uint32_t>(attempt, 5);
  uint32_t nominal = std::min<uint32_t>(RECONNECT_BASE_MS << exponent, RECONNECT_MAX_MS);
  uint64_t factor = 800 + 400ULL * std::min<uint32_t>(permille, 1000) / 1000;
  return std::min<uint32_t>(static_cast<uint32_t>(nominal * factor / 1000), RECONNECT_MAX_MS);
}

}  // namespace aegis
