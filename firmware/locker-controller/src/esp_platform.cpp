#include "esp_platform.h"

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_random.h>
#include <esp_system.h>

#include <cstdio>
#include <cstring>
#include <ctime>

namespace aegis {

namespace {

// 2023-11-14: any earlier clock reading means SNTP has not set the time yet.
constexpr time_t MIN_SYNCED_UNIX_SECONDS = 1700000000;

}  // namespace

uint32_t EspPlatform::nowMs() { return millis(); }

int64_t EspPlatform::unixSeconds() { return static_cast<int64_t>(time(nullptr)); }

bool EspPlatform::clockSynchronized() { return time(nullptr) >= MIN_SYNCED_UNIX_SECONDS; }

bool EspPlatform::networkUp() { return WiFi.status() == WL_CONNECTED; }

int EspPlatform::rssiDbm() { return WiFi.RSSI(); }

void EspPlatform::newUuid(char out[UUID_LEN]) {
  uint8_t b[16];
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0F) | 0x40;  // version 4
  b[8] = (b[8] & 0x3F) | 0x80;  // RFC 4122 variant
  snprintf(out, UUID_LEN, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0], b[1], b[2],
           b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
}

uint32_t EspPlatform::random(uint32_t bound) { return bound == 0 ? 0 : esp_random() % bound; }

// Doc 10 §8.1: the counter lives in NVS, grows by one per boot and is read back before use.
bool EspPlatform::incrementBootCount(uint32_t* bootCount) {
  Preferences prefs;
  if (!prefs.begin("aegis", false)) return false;
  uint32_t next = prefs.getUInt("bootCount", 0) + 1;
  bool ok = next != 0 && prefs.putUInt("bootCount", next) == sizeof(uint32_t) && prefs.getUInt("bootCount", 0) == next;
  prefs.end();
  if (ok) *bootCount = next;
  return ok;
}

// Doc 10 §13.1 mapping of the hardware cause to the controlled list.
const char* EspPlatform::resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWER_ON";
    case ESP_RST_EXT: return "EXTERNAL_RESET";
    case ESP_RST_SW: return "SOFTWARE_RESET";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "WATCHDOG";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    default: return "UNKNOWN";
  }
}

void EspPlatform::log(const char* line) { Serial.println(line); }

void EspMqttTransport::teardown() {
  if (client_ == nullptr) return;
  esp_mqtt_client_stop(client_);
  esp_mqtt_client_destroy(client_);
  client_ = nullptr;
  connected_ = false;
  changed_ = false;
}

void EspMqttTransport::connect(const Message& will) {
  teardown();

  strlcpy(willTopic_, will.topic, sizeof(willTopic_));
  strlcpy(willPayload_, will.payload, sizeof(willPayload_));

  esp_mqtt_client_config_t config = {};
  config.broker.address.hostname = settings_.host;
  config.broker.address.port = settings_.port;
  config.broker.address.transport = MQTT_TRANSPORT_OVER_SSL;
  config.broker.verification.certificate = settings_.caCertPem;
  config.credentials.client_id = settings_.clientId;
  config.credentials.username = settings_.username;
  config.credentials.authentication.password = settings_.password;
  config.session.last_will.topic = willTopic_;
  config.session.last_will.msg = willPayload_;
  config.session.last_will.msg_len = static_cast<int>(strlen(willPayload_));
  config.session.last_will.qos = will.qos;
  config.session.last_will.retain = will.retain ? 1 : 0;
  config.session.disable_clean_session = true;
  config.session.keepalive = 30;
  config.session.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
  config.network.disable_auto_reconnect = true;

  client_ = esp_mqtt_client_init(&config);
  if (client_ == nullptr) {
    connected_ = false;
    changed_ = true;  // reported as a failed attempt, so HubLink backs off
    return;
  }
  esp_mqtt_client_register_event(client_, MQTT_EVENT_ANY, onEvent, this);
  esp_mqtt_client_start(client_);
}

bool EspMqttTransport::publish(const Message& message) {
  if (client_ == nullptr) return false;
  return esp_mqtt_client_publish(client_, message.topic, message.payload, 0, message.qos, message.retain ? 1 : 0) >= 0;
}

Transport::Event EspMqttTransport::pollEvent() {
  if (!changed_.exchange(false)) return Event::None;
  return connected_ ? Event::Connected : Event::Disconnected;
}

// Runs on the esp-mqtt task: it only records the latest connection state.
void EspMqttTransport::onEvent(void* handlerArgs, esp_event_base_t, int32_t eventId, void*) {
  auto* self = static_cast<EspMqttTransport*>(handlerArgs);
  if (eventId == MQTT_EVENT_CONNECTED) {
    self->connected_ = true;
    self->changed_ = true;
  } else if (eventId == MQTT_EVENT_DISCONNECTED) {
    self->connected_ = false;
    self->changed_ = true;
  }
}

}  // namespace aegis
