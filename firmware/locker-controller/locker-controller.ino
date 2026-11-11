// Aegis hub firmware (FW-00, FW-01): the hub joins Wi-Fi, synchronizes its clock, keeps an MQTT
// connection to the broker with its device identity (doc 10 §4, §7, §14, §15, §18) and polls
// cells A1 and A2 over two independent RS-485 segments (ADR-002). Each heartbeat carries, per
// cell, the link, the reader health and the latch state the cell reported, and each finished
// scan window of a cell is published as RFID_SCAN_COMPLETED. Copy
// secrets.h.example to secrets.h first.

#include <WiFi.h>
#include <time.h>

#include "secrets.h"
#include "src/cell_link.h"
#include "src/esp_platform.h"
#include "src/hub_link.h"

constexpr const char* FIRMWARE_VERSION = "0.3.0";

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

static aegis::CellObservation observe(const aegis::CellLink& cell) {
  return {cell.connectionStatus(), cell.readerStatus(), cell.lockState()};
}

static aegis::CellObservation cellStatus(int cellAddress) {
  if (cellAddress == 1) return observe(cellA1);
  if (cellAddress == 2) return observe(cellA2);
  return {"UNKNOWN", "UNKNOWN", "UNKNOWN"};
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

static void publishScans(aegis::CellLink& cell) {
  static aegis::ScanResult scan;  // static: about 300 bytes, kept off the loop task stack
  if (!cell.takeScan(&scan)) return;
  bool sent = hub.publishScan(cell.expectedAddress(), scan);
  Serial.printf("cell %u: scan %s, reader %s, %u tag(s)\n", cell.expectedAddress(), sent ? "published" : "dropped",
                aegis::cellframe::readerStatusName(scan.reader), scan.tagCount);
}

void loop() {
  cellA1.loop();
  cellA2.loop();
  hub.loop();
  publishScans(cellA1);
  publishScans(cellA2);
  delay(10);
}
