#pragma once

#include <mqtt_client.h>

#include <atomic>

#include "platform.h"

namespace aegis {

// ESP32 implementations of the hardware interfaces. Not built on a host.

class EspPlatform : public Platform {
 public:
  uint32_t nowMs() override;
  int64_t unixSeconds() override;
  bool clockSynchronized() override;
  bool networkUp() override;
  int rssiDbm() override;
  void newUuid(char out[UUID_LEN]) override;
  uint32_t random(uint32_t bound) override;
  bool incrementBootCount(uint32_t* bootCount) override;
  const char* resetReason() override;
  void log(const char* line) override;
};

struct MqttSettings {
  const char* host;
  uint16_t port;
  const char* caCertPem;  // PEM with a terminating NUL; must outlive the transport
  const char* clientId;
  const char* username;
  const char* password;
};

// MQTT 3.1.1 over TLS with server certificate validation, cleanSession=false and
// keepalive 30 s (doc 10 §4.2, §7.1). Auto-reconnect is off: HubLink prepares a new
// Last Will and connectionId before every attempt, so each attempt builds a new client.
class EspMqttTransport : public Transport {
 public:
  explicit EspMqttTransport(const MqttSettings& settings) : settings_(settings) {}
  ~EspMqttTransport() override { teardown(); }

  void connect(const Message& will) override;
  bool publish(const Message& message) override;
  void abort() override { teardown(); }
  Event pollEvent() override;

 private:
  static void onEvent(void* handlerArgs, esp_event_base_t base, int32_t eventId, void* eventData);
  void teardown();

  const MqttSettings& settings_;
  esp_mqtt_client_handle_t client_ = nullptr;
  // The client keeps pointers to its Last Will until it is destroyed.
  char willTopic_[sizeof(Message::topic)] = {};
  char willPayload_[sizeof(Message::payload)] = {};
  std::atomic<bool> changed_{false};
  std::atomic<bool> connected_{false};
};

}  // namespace aegis
