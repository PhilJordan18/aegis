// Host tests of the hub connection logic and message builders (no board needed).
// Run with tests/host/run.sh. Assert-based: a failure aborts with the failing line.

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <string>
#include <vector>

#include "../../src/backoff.h"
#include "../../src/hub_link.h"

using namespace aegis;

namespace {

struct FakePlatform : Platform {
  uint32_t now = 0;
  int64_t unix = 1789000000;  // 2026-09-10
  bool synced = false;
  bool network = false;
  bool bootCounterWorks = true;
  uint32_t bootCounter = 3;
  uint32_t uuidCounter = 0;
  uint32_t permille = 500;  // jitter factor 1.0

  uint32_t nowMs() override { return now; }
  int64_t unixSeconds() override { return unix; }
  bool clockSynchronized() override { return synced; }
  bool networkUp() override { return network; }
  int rssiDbm() override { return -57; }
  void newUuid(char out[UUID_LEN]) override {
    snprintf(out, UUID_LEN, "00000000-0000-4000-8000-%012lu", static_cast<unsigned long>(++uuidCounter));
  }
  uint32_t random(uint32_t) override { return permille; }
  bool incrementBootCount(uint32_t* bootCount) override {
    if (!bootCounterWorks) return false;
    *bootCount = ++bootCounter;
    return true;
  }
  const char* resetReason() override { return "POWER_ON"; }
};

struct FakeTransport : Transport {
  std::vector<Message> wills;
  std::vector<Message> published;
  std::deque<Event> events;
  int aborts = 0;
  bool refusePublish = false;

  void connect(const Message& will) override { wills.push_back(will); }
  bool publish(const Message& message) override {
    if (refusePublish) return false;
    published.push_back(message);
    return true;
  }
  void abort() override { aborts++; }
  Event pollEvent() override {
    if (events.empty()) return Event::None;
    Event e = events.front();
    events.pop_front();
    return e;
  }
};

const char* LOCKER = "d46a74ae-39dc-460b-8af0-38fc791b376a";
const CompartmentConfig COMPARTMENTS[] = {{"1ae77ae3-8490-4f09-9412-a7816b77bff9", 1},
                                          {"2be88bf4-9591-4a1a-a523-b8927c88c0aa", 2}};
const HubConfig CONFIG = {LOCKER, "0.1.0", COMPARTMENTS, 2};

bool has(const Message& m, const char* fragment) { return strstr(m.payload, fragment) != nullptr; }

std::string field(const Message& m, const char* key) {
  std::string needle = std::string("\"") + key + "\":\"";
  const char* p = strstr(m.payload, needle.c_str());
  assert(p != nullptr);
  p += needle.size();
  return std::string(p, strchr(p, '"') - p);
}

long number(const Message& m, const char* key) {
  std::string needle = std::string("\"") + key + "\":";
  const char* p = strstr(m.payload, needle.c_str());
  assert(p != nullptr);
  return strtol(p + needle.size(), nullptr, 10);
}

struct Rig {
  FakePlatform platform;
  FakeTransport transport;
  HubLink hub{CONFIG, transport, platform};

  void ready() {
    platform.network = true;
    platform.synced = true;
  }
  void connectOnce() {
    ready();
    assert(hub.begin());
    hub.loop();
    transport.events.push_back(Transport::Event::Connected);
    hub.loop();
  }
};

void waitsForNetworkAndClock() {
  Rig r;
  assert(r.hub.begin());
  r.hub.loop();
  assert(r.transport.wills.empty());
  r.platform.network = true;
  r.hub.loop();
  assert(r.transport.wills.empty());  // clock not synchronized yet
  r.platform.synced = true;
  r.hub.loop();
  assert(r.transport.wills.size() == 1);
  assert(r.transport.published.empty());  // nothing before the CONNACK
}

void connectionPublishesWillOnlineRestartedHeartbeatInOrder() {
  Rig r;
  r.connectOnce();

  const Message& will = r.transport.wills[0];
  assert(will.qos == 1 && will.retain);
  assert(strcmp(will.topic, "aegis/v1/lockers/d46a74ae-39dc-460b-8af0-38fc791b376a/status") == 0);
  assert(has(will, "\"status\":\"OFFLINE\"") && has(will, "\"reason\":\"CONNECTION_LOST\""));
  assert(number(will, "sequence") == 0 && number(will, "bootCount") == 4);

  assert(r.transport.published.size() == 3);
  const Message& online = r.transport.published[0];
  const Message& restarted = r.transport.published[1];
  const Message& heartbeat = r.transport.published[2];

  assert(has(online, "\"type\":\"DEVICE_AVAILABILITY\"") && has(online, "\"status\":\"ONLINE\""));
  assert(has(online, "\"reason\":\"CONNECTED\""));
  assert(online.qos == 1 && online.retain && number(online, "sequence") == 1);

  assert(has(restarted, "\"type\":\"DEVICE_RESTARTED\"") && has(restarted, "\"resetReason\":\"POWER_ON\""));
  assert(strstr(restarted.topic, "/events") != nullptr);
  assert(restarted.qos == 1 && !restarted.retain && number(restarted, "sequence") == 2);

  assert(has(heartbeat, "\"type\":\"HEARTBEAT\"") && has(heartbeat, "\"clockSynchronized\":true"));
  assert(has(heartbeat, "\"rssiDbm\":-57") && has(heartbeat, "\"connectionStatus\":\"UNKNOWN\""));
  assert(heartbeat.qos == 0 && !heartbeat.retain && number(heartbeat, "sequence") == 3);

  // One connectionId for the Will, the ONLINE and the heartbeats of this connection (§15.2).
  assert(field(will, "connectionId") == field(online, "connectionId"));
  assert(field(will, "connectionId") == field(heartbeat, "connectionId"));
  assert(field(online, "deviceSessionId") == field(heartbeat, "deviceSessionId"));
  assert(field(online, "messageId") != field(will, "messageId"));
}

void heartbeatEveryTenSeconds() {
  Rig r;
  r.connectOnce();
  size_t before = r.transport.published.size();
  r.platform.now = 9999;
  r.hub.loop();
  assert(r.transport.published.size() == before);
  r.platform.now = 10000;
  r.hub.loop();
  assert(r.transport.published.size() == before + 1);
  assert(has(r.transport.published.back(), "\"type\":\"HEARTBEAT\""));
  assert(number(r.transport.published.back(), "uptimeSeconds") == 10);
  assert(number(r.transport.published.back(), "sequence") == 4);
}

void reconnectsWithNewWillAndWithoutSecondRestart() {
  Rig r;
  r.connectOnce();
  std::string firstConnection = field(r.transport.wills[0], "connectionId");

  r.platform.now = 5000;
  r.transport.events.push_back(Transport::Event::Disconnected);
  r.hub.loop();
  assert(r.hub.state() == HubLink::State::Backoff);
  r.platform.now = 5999;
  r.hub.loop();
  assert(r.transport.wills.size() == 1);  // first retry waits 1 s
  r.platform.now = 6000;
  r.hub.loop();
  assert(r.transport.wills.size() == 2);

  const Message& will = r.transport.wills[1];
  assert(field(will, "connectionId") != firstConnection);
  assert(field(will, "messageId") != field(r.transport.wills[0], "messageId"));
  assert(number(will, "sequence") > number(r.transport.published.back(), "sequence"));
  assert(number(will, "bootCount") == 4);  // same boot

  size_t before = r.transport.published.size();
  r.transport.events.push_back(Transport::Event::Connected);
  r.hub.loop();
  assert(r.transport.published.size() == before + 2);  // ONLINE and an immediate heartbeat
  assert(has(r.transport.published[before], "\"status\":\"ONLINE\""));
  assert(field(r.transport.published[before], "connectionId") == field(will, "connectionId"));
  assert(has(r.transport.published[before + 1], "\"type\":\"HEARTBEAT\""));
}

void connectTimeoutAbortsAndBacksOff() {
  Rig r;
  r.ready();
  assert(r.hub.begin());
  r.hub.loop();
  r.platform.now = CONNECT_TIMEOUT_MS - 1;
  r.hub.loop();
  assert(r.transport.aborts == 0);
  r.platform.now = CONNECT_TIMEOUT_MS;
  r.hub.loop();
  assert(r.transport.aborts == 1 && r.hub.state() == HubLink::State::Backoff);
}

void refusedOnlineDropsTheConnection() {
  Rig r;
  r.ready();
  assert(r.hub.begin());
  r.hub.loop();
  r.transport.refusePublish = true;
  r.transport.events.push_back(Transport::Event::Connected);
  r.hub.loop();
  assert(r.transport.aborts == 1 && r.hub.state() == HubLink::State::Backoff);
}

void bootCounterFailureKeepsTheHubSilent() {
  Rig r;
  r.ready();
  r.platform.bootCounterWorks = false;
  assert(!r.hub.begin());
  r.hub.loop();
  assert(r.hub.state() == HubLink::State::Halted);
  assert(r.transport.wills.empty() && r.transport.published.empty());
}

void backoffSchedule() {
  const uint32_t expected[] = {1000, 2000, 4000, 8000, 16000, 30000, 30000};
  for (uint32_t attempt = 0; attempt < 7; attempt++) {
    assert(reconnectDelayMs(attempt, 500) == expected[attempt]);
  }
  assert(reconnectDelayMs(0, 0) == 800 && reconnectDelayMs(0, 1000) == 1200);
  assert(reconnectDelayMs(9, 1000) == RECONNECT_MAX_MS);  // jitter never exceeds the cap
}

// A heartbeat with the most cells and the widest values must fit the message buffer.
void worstCaseHeartbeatFits() {
  Envelope env{LOCKER, "9445c92f-95da-4806-a911-ff60db45f713", "2026-09-16T14:31:10Z",
               "a36e9e94-b690-4e41-a14c-3cf8032742b0", 4294967295u, 4294967295u};
  CompartmentFacts cell{"1ae77ae3-8490-4f09-9412-a7816b77bff9", 247, "DISCONNECTED", "HEALTHY", "UNKNOWN", "UNLOCKED"};
  CompartmentFacts cells[MAX_COMPARTMENTS] = {cell, cell, cell, cell};
  HeartbeatFacts facts{"5b0f3c1e-7d2a-4c8e-9f61-2a4d8e7b9c03", "0.1.0", 4294967295u, true, -100, cells,
                       MAX_COMPARTMENTS};
  static Message m;
  assert(buildHeartbeat(&m, env, facts));
}

void instantFormat() {
  char out[INSTANT_LEN];
  formatInstant(1789000000, out);
  assert(strcmp(out, "2026-09-10T00:26:40Z") == 0);
}

// Prints every payload on its own line so run.sh can check that it is strict JSON.
void dumpPayloads(const char* path) {
  Rig r;
  r.connectOnce();
  FILE* f = fopen(path, "w");
  assert(f != nullptr);
  fprintf(f, "%s\n", r.transport.wills[0].payload);
  for (const Message& m : r.transport.published) fprintf(f, "%s\n", m.payload);
  fclose(f);
}

}  // namespace

int main(int argc, char** argv) {
  waitsForNetworkAndClock();
  connectionPublishesWillOnlineRestartedHeartbeatInOrder();
  heartbeatEveryTenSeconds();
  reconnectsWithNewWillAndWithoutSecondRestart();
  connectTimeoutAbortsAndBacksOff();
  refusedOnlineDropsTheConnection();
  bootCounterFailureKeepsTheHubSilent();
  backoffSchedule();
  worstCaseHeartbeatFits();
  instantFormat();
  if (argc > 1) dumpPayloads(argv[1]);
  puts("all host tests passed");
  return 0;
}
