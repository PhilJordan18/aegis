#pragma once

#include <cstddef>

namespace aegis {

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

}  // namespace aegis
