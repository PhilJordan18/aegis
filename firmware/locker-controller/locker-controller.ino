// Aegis hub firmware (FW-00): the hub joins Wi-Fi, synchronizes its clock, keeps an MQTT
// connection to the broker with its device identity (doc 10 §4, §7, §14, §15, §18) and polls
// cells A1 and A2 over two independent RS-485 segments (ADR-002). Copy secrets.h.example to
// secrets.h first.

#include <WiFi.h>
#include <time.h>

#include "secrets.h"
#include "src/cell_link.h"
#include "src/esp_platform.h"
#include "src/hub_link.h"

constexpr const char* FIRMWARE_VERSION = "0.1.0";

// One UART per segment, never a shared bus. Segment 1 keeps the pins of the POC-02 bench; on the
// Freenove WROVER camera board 16/17 belong to PSRAM and 4/5/18-27/34-39 to the camera, so
// segment 2 uses 13/14.
constexpr uint32_t CELL_BAUD = 115200;  // must match the cells; passed 10,000/10,000 frames on the bench
constexpr int PORT1_RX_PIN = 32;
constexpr int PORT1_TX_PIN = 33;
constexpr int PORT2_RX_PIN = 13;
constexpr int PORT2_TX_PIN = 14;

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

static aegis::EspCellPort port1(Serial2);
static aegis::EspCellPort port2(Serial1);
static aegis::CellLink cellA1(1, port1, platform);
static aegis::CellLink cellA2(2, port2, platform);

static const char* cellStatus(int cellAddress) {
  if (cellAddress == 1) return cellA1.connectionStatus();
  if (cellAddress == 2) return cellA2.connectionStatus();
  return "UNKNOWN";
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(CELL_BAUD, SERIAL_8N1, PORT1_RX_PIN, PORT1_TX_PIN);
  Serial1.begin(CELL_BAUD, SERIAL_8N1, PORT2_RX_PIN, PORT2_TX_PIN);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  hub.cellStatus(cellStatus);
  hub.begin();
}

void loop() {
  cellA1.loop();
  cellA2.loop();
  hub.loop();
  delay(10);
}
