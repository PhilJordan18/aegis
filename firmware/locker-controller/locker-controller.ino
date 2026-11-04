// Aegis hub firmware, FW-00 first slice: the hub joins Wi-Fi, synchronizes its clock and
// keeps an MQTT connection to the broker with its device identity (doc 10 §4, §7, §14, §15, §18).
// Cells and commands arrive in later slices. Copy secrets.h.example to secrets.h first.

#include <WiFi.h>
#include <time.h>

#include "secrets.h"
#include "src/esp_platform.h"
#include "src/hub_link.h"

constexpr const char* FIRMWARE_VERSION = "0.1.0";

static const aegis::CompartmentConfig kCompartments[] = {
    {COMPARTMENT_A1_ID, 1},
    {COMPARTMENT_A2_ID, 2},
};
static const aegis::HubConfig kHubConfig = {LOCKER_ID, FIRMWARE_VERSION, kCompartments, 2};

// The MQTT username is the lockerId: the broker ACL confines each hub to its own topics.
static const aegis::MqttSettings kMqtt = {MQTT_HOST, MQTT_PORT, MQTT_CA_PEM, "aegis-locker-" DEVICE_KEY, LOCKER_ID,
                                          MQTT_PASSWORD};

static aegis::EspPlatform platform;
static aegis::EspMqttTransport transport(kMqtt);
static aegis::HubLink hub(kHubConfig, transport, platform);

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  hub.begin();
}

void loop() {
  hub.loop();
  delay(10);
}
