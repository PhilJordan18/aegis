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
#include "../../src/cell_link.h"
#include "../../src/display_frame.h"
#include "../../src/hub_link.h"
#include "../../src/i2c_display.h"

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
  std::vector<std::string> logs;
  void log(const char* line) override { logs.push_back(line); }
  std::vector<std::vector<uint8_t>> journal = std::vector<std::vector<uint8_t>>(64);
  bool journalFails = false;
  bool journalRead(size_t slot, void* buf, size_t len) override {
    if (journal[slot].size() != len) return false;
    memcpy(buf, journal[slot].data(), len);
    return true;
  }
  bool journalWrite(size_t slot, const void* buf, size_t len) override {
    if (journalFails) return false;
    journal[slot].assign(static_cast<const uint8_t*>(buf), static_cast<const uint8_t*>(buf) + len);
    return true;
  }
};

struct FakeTransport : Transport {
  std::vector<Message> wills;
  std::vector<Message> published;
  std::deque<Event> events;
  int aborts = 0;
  bool refusePublish = false;
  bool refuseSubscribe = false;
  std::vector<std::string> subscriptions;
  std::deque<Message> inbound;

  void connect(const Message& will) override { wills.push_back(will); }
  bool publish(const Message& message) override {
    if (refusePublish) return false;
    published.push_back(message);
    return true;
  }
  bool subscribe(const char* topic, int qos) override {
    if (refuseSubscribe) return false;
    subscriptions.push_back(std::string(topic) + "@" + std::to_string(qos));
    return true;
  }
  bool pollMessage(Message* out) override {
    if (inbound.empty()) return false;
    *out = inbound.front();
    inbound.pop_front();
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

const char* MSG_ID = "55c71961-21a3-4b2e-8b92-7f237e881a20";
const char* OP_ID = "2f38d3b6-c18f-4a74-aa9a-2d574286013f";
const char* COMMANDS_TOPIC = "aegis/v1/lockers/d46a74ae-39dc-460b-8af0-38fc791b376a/commands";

Message command(const char* messageId, const char* operationId, const char* expiresAt, bool retain = false,
                const char* locker = "d46a74ae-39dc-460b-8af0-38fc791b376a") {
  Message m = {};
  strcpy(m.topic, COMMANDS_TOPIC);
  m.retain = retain;
  m.qos = 1;
  snprintf(m.payload, sizeof(m.payload),
           "{\"schemaVersion\":\"3.0\",\"messageId\":\"%s\",\"type\":\"UNLOCK_COMPARTMENT\","
           "\"operationId\":\"%s\",\"lockerId\":\"%s\",\"compartmentId\":\"1ae77ae3-8490-4f09-9412-a7816b77bff9\","
           "\"issuedAt\":\"2026-09-10T00:00:00Z\",\"expiresAt\":\"%s\"}",
           messageId, operationId, locker, expiresAt);
  return m;
}

int g_calls = 0;
bool g_actuates = true;
bool actuate(const Command&) {
  g_calls++;
  return g_actuates;
}

// 1789000000 is 2026-09-10T00:26:40Z, so :28:00 is still valid and :20:00 is expired.
const char* LATER = "2026-09-10T00:28:00Z";
const char* EARLIER = "2026-09-10T00:20:00Z";
const char* OP2 = "22222222-2222-4222-8222-222222222222";
const char* CELL1 = "1ae77ae3-8490-4f09-9412-a7816b77bff9";

std::string type(const Message& m) { return field(m, "type"); }

// Delivers one message and returns what the hub published in answer.
std::vector<Message> deliver(HubLink& hub, FakeTransport& t, const Message& m) {
  size_t before = t.published.size();
  t.inbound.push_back(m);
  hub.loop();
  return std::vector<Message>(t.published.begin() + before, t.published.end());
}

void bringUp(HubLink& hub, FakeTransport& t, FakePlatform& p) {
  p.network = p.synced = true;
  assert(hub.begin());
  hub.loop();
  t.events.push_back(Transport::Event::Connected);
  hub.loop();
}

void subscribesToCommandsOnEveryConnection() {
  Rig r;
  r.connectOnce();
  assert(r.transport.subscriptions.size() == 1);
  assert(r.transport.subscriptions[0] == std::string(COMMANDS_TOPIC) + "@1");
  r.transport.events.push_back(Transport::Event::Disconnected);
  r.hub.loop();
  r.platform.now += 60000;
  r.hub.loop();
  r.transport.events.push_back(Transport::Event::Connected);
  r.hub.loop();
  assert(r.transport.subscriptions.size() == 2);
}

void refusedSubscriptionDropsTheConnection() {
  Rig r;
  r.transport.refuseSubscribe = true;
  r.connectOnce();
  assert(r.transport.aborts == 1);
  assert(r.hub.state() == HubLink::State::Backoff);
}

void commandIsActedOnceAndAnswered() {
  Rig r;
  g_calls = 0;
  g_actuates = true;
  r.hub.onCommand(actuate);
  r.connectOnce();

  auto out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));
  assert(g_calls == 1 && out.size() == 1);
  assert(type(out[0]) == "COMMAND_ACKNOWLEDGED" && field(out[0], "result") == "ACCEPTED");
  assert(field(out[0], "commandMessageId") == MSG_ID && out[0].qos == 1 && !out[0].retain);

  // Redelivery, even after expiry, and a new message for the same operation and cell: no second actuation.
  out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));
  assert(type(out[0]) == "COMMAND_ACKNOWLEDGED" && field(out[0], "result") == "ALREADY_APPLIED");
  out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, EARLIER));
  assert(field(out[0], "result") == "ALREADY_APPLIED");
  const char* MSG2 = "11111111-1111-4111-8111-111111111111";
  out = deliver(r.hub, r.transport, command(MSG2, OP_ID, LATER));
  assert(field(out[0], "result") == "ALREADY_APPLIED" && field(out[0], "commandMessageId") == MSG2);
  assert(g_calls == 1);
}

void refusalsAreAnsweredAndRemembered() {
  Rig r;
  g_calls = 0;
  r.hub.onCommand(actuate);
  r.connectOnce();

  auto out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, EARLIER));
  assert(type(out[0]) == "COMMAND_REJECTED" && field(out[0], "reason") == "COMMAND_EXPIRED");
  out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));  // same messageId: the known rejection
  assert(field(out[0], "reason") == "COMMAND_EXPIRED");
  out = deliver(r.hub, r.transport, command("33333333-3333-4333-8333-333333333333", OP_ID, LATER));
  assert(field(out[0], "result") == "ACCEPTED");  // a rejection before actuation does not consume the operation

  out = deliver(r.hub, r.transport,
                command("44444444-4444-4444-8444-444444444444", OP2, LATER, false, "00000000-0000-4000-8000-000000000001"));
  assert(field(out[0], "reason") == "WRONG_LOCKER");
  Message major = command("55555555-5555-4555-8555-555555555555", OP2, LATER);
  major.payload[strstr(major.payload, "3.0") - major.payload] = '4';
  out = deliver(r.hub, r.transport, major);
  assert(field(out[0], "reason") == "UNSUPPORTED_SCHEMA");
  r.platform.synced = false;
  out = deliver(r.hub, r.transport, command("66666666-6666-4666-8666-666666666666", OP2, LATER));
  assert(field(out[0], "reason") == "CLOCK_NOT_SYNCHRONIZED");
  assert(g_calls == 1);
}

void failedActuationIsRejectedAndConsumes() {
  Rig r;
  g_calls = 0;
  g_actuates = false;
  r.hub.onCommand(actuate);
  r.connectOnce();
  auto out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));
  assert(field(out[0], "reason") == "LOCK_ACTUATION_FAILED");
  g_actuates = true;
  out = deliver(r.hub, r.transport, command("11111111-1111-4111-8111-111111111111", OP_ID, LATER));
  assert(field(out[0], "reason") == "LOCK_ACTUATION_FAILED" && g_calls == 1);  // the operation is consumed
  g_actuates = true;
}

void unsafeJournalOrMissingHandlerNeverActuates() {
  Rig r;
  g_calls = 0;
  r.connectOnce();  // no handler
  auto out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));
  assert(field(out[0], "reason") == "INTERNAL_DEVICE_ERROR");

  r.hub.onCommand(actuate);
  r.platform.journalFails = true;  // EXECUTING cannot be stored: no actuation
  out = deliver(r.hub, r.transport, command("11111111-1111-4111-8111-111111111111", OP2, LATER));
  assert(field(out[0], "reason") == "INTERNAL_DEVICE_ERROR" && g_calls == 0);
}

void journalSurvivesAReboot() {
  Rig r;
  g_calls = 0;
  r.hub.onCommand(actuate);
  r.connectOnce();
  deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));
  assert(g_calls == 1);

  FakeTransport t2;  // reboot: same flash, new objects
  HubLink hub2(CONFIG, t2, r.platform);
  hub2.onCommand(actuate);
  bringUp(hub2, t2, r.platform);
  auto out = deliver(hub2, t2, command(MSG_ID, OP_ID, LATER));
  assert(field(out[0], "result") == "ALREADY_APPLIED" && g_calls == 1);
}

void commandInterruptedByRebootIsUncertainAndNeverRepeated() {
  FakePlatform p;
  g_calls = 0;
  {
    CommandInbox crashed(CONFIG, p);  // the power dies right after EXECUTING is stored
    Command c = {};
    strcpy(c.messageId, MSG_ID);
    strcpy(c.operationId, OP_ID);
    strcpy(c.compartmentId, CELL1);
    c.expiresAt = 1789000100;
    assert(crashed.begin(c, 1789000000));
  }
  FakeTransport t;
  HubLink hub(CONFIG, t, p);
  hub.onCommand(actuate);
  bringUp(hub, t, p);
  int reports = 0;
  for (const Message& m : t.published) {
    if (type(m) == "COMMAND_REJECTED") {
      reports++;
      assert(field(m, "reason") == "PREVIOUS_EXECUTION_UNCERTAIN" && field(m, "commandMessageId") == MSG_ID);
    }
  }
  assert(reports == 1);
  p.now += 11000;
  hub.loop();  // not reported again at the next heartbeat
  reports = 0;
  for (const Message& m : t.published) reports += type(m) == "COMMAND_REJECTED";
  assert(reports == 1);

  auto out = deliver(hub, t, command("11111111-1111-4111-8111-111111111111", OP_ID, LATER));  // same operation
  assert(field(out[0], "reason") == "PREVIOUS_EXECUTION_UNCERTAIN" && g_calls == 0);
}

void invalidInboundIsReportedWithinTheRateLimit() {
  Rig r;
  g_calls = 0;
  r.hub.onCommand(actuate);
  r.connectOnce();

  auto out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER, true));  // retained, otherwise valid
  assert(out.size() == 1 && type(out[0]) == "DEVICE_ERROR" && field(out[0], "errorCode") == "INBOUND_MESSAGE_INVALID");
  assert(field(out[0], "severity") == "WARNING" && field(out[0], "compartmentId") == CELL1);
  assert(!has(out[0], "operationId") && !has(out[0], MSG_ID) && !out[0].retain && out[0].qos == 1);
  assert(deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER, true)).empty());  // limited
  r.platform.now += 61000;
  out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER, true));
  assert(out.size() >= 1 && has(out[0], "Not reported since the previous report: 1."));

  // The retained command consumed nothing: the same command arriving normally runs.
  out = deliver(r.hub, r.transport, command(MSG_ID, OP_ID, LATER));
  assert(field(out[0], "result") == "ACCEPTED" && g_calls == 1);

  Message garbage = {};
  strcpy(garbage.topic, COMMANDS_TOPIC);
  strcpy(garbage.payload, "{\"messageId\":\"not-a-uuid\"}");
  out = deliver(r.hub, r.transport, garbage);  // its own limiter: reported at once
  assert(out.size() == 1 && has(out[0], "uncorrelable") && !has(out[0], "compartmentId"));
  strcpy(garbage.payload, "[]");
  assert(deliver(r.hub, r.transport, garbage).empty());
  assert(g_calls == 1);
}

void parseInstantRules() {
  int64_t t = 0;
  assert(parseInstant("2026-09-10T00:26:40Z", &t) && t == 1789000000);
  assert(parseInstant("1970-01-01T00:00:00Z", &t) && t == 0);
  assert(!parseInstant("2026-09-10 00:26:40Z", &t));
  assert(!parseInstant("2026-09-10T00:26:40+00:00", &t));
  assert(!parseInstant("2026-13-10T00:26:40Z", &t));
}

void instantFormat() {
  char out[INSTANT_LEN];
  formatInstant(1789000000, out);
  assert(strcmp(out, "2026-09-10T00:26:40Z") == 0);
}

// ---------------------------------------------------------------- cell links (ADR-002)

struct FakePort : CellPort {
  std::deque<char> rx;  // bytes the hub will read
  std::string tx;       // bytes the hub wrote
  int read() override {
    if (rx.empty()) return -1;
    char c = rx.front();
    rx.pop_front();
    return static_cast<unsigned char>(c);
  }
  void write(const char* data, size_t len) override { tx.append(data, len); }
  void receive(const std::string& bytes) { rx.insert(rx.end(), bytes.begin(), bytes.end()); }
};

// The last request the hub wrote on `port` (PING, SCAN or TAG?), consuming what it wrote.
struct Request {
  char kind;
  uint32_t seq;
  uint8_t index;
};

Request lastRequest(FakePort& port) {
  size_t end = port.tx.rfind('\n');
  assert(end != std::string::npos);
  size_t start = port.tx.rfind('\n', end - 1);
  std::string line = port.tx.substr(start == std::string::npos ? 0 : start + 1, end - (start == std::string::npos ? 0 : start + 1));
  port.tx.clear();
  std::vector<char> buf(line.begin(), line.end());
  buf.push_back('\0');
  assert(cellframe::unseal(buf.data()));
  Request r{buf[0], 0, 0};
  assert(cellframe::parsePing(buf.data(), &r.seq) || cellframe::parseScan(buf.data(), &r.seq) ||
         cellframe::parseTagRequest(buf.data(), &r.seq, &r.index));
  return r;
}

uint32_t lastPing(FakePort& port) { return lastRequest(port).seq; }

std::string replyFrame(uint32_t seq, uint8_t address, uint32_t bootId = 0xB0071D01, uint8_t reset = 1,
                       char lock = 'L', char reader = 'H', char scan = 'I', uint8_t tags = 0, char scanReader = '-') {
  char frame[cellframe::MAX_LINE];
  cellframe::Reply reply{seq, address, bootId, reset, lock, reader, scan, tags, scanReader};
  size_t n = cellframe::encodeReply(reply, frame, sizeof(frame));
  assert(n > 0);
  return std::string(frame, n);
}

std::string tagFrame(uint32_t seq, uint8_t address, uint8_t index, const char* epc, uint16_t count) {
  cellframe::Tag t;
  t.readCount = count;
  strcpy(t.epc, epc);
  char frame[cellframe::MAX_LINE];
  size_t n = cellframe::encodeTag(seq, address, index, t, frame, sizeof(frame));
  assert(n > 0);
  return std::string(frame, n);
}

// A cell on the other end of a FakePort: answers PING and SCAN with a REPLY, runs a 3 s window
// after a SCAN, and answers TAG? from its tag list.
struct FakeCell {
  uint8_t address = 1;
  char lock = 'L';
  char reader = 'H';
  bool silent = false;
  char scan = 'I';
  uint32_t windowEndsMs = 0;
  char scanReader = 'H';
  std::vector<std::pair<std::string, uint16_t>> tags;
  uint32_t scansStarted = 0;

  void answer(FakePort& port, uint32_t now) {
    Request q = lastRequest(port);
    if (silent) return;
    if (scan == 'W' && static_cast<int32_t>(now - windowEndsMs) >= 0) scan = 'D';
    if (q.kind == 'T') {
      if (scan == 'D' && q.index < tags.size()) {
        port.receive(tagFrame(q.seq, address, q.index, tags[q.index].first.c_str(), tags[q.index].second));
      }
      return;
    }
    if (q.kind == 'S' && scan != 'W') {
      scan = 'W';
      windowEndsMs = now + 3000;
      scansStarted++;
    }
    bool done = scan == 'D';
    port.receive(replyFrame(q.seq, address, 0xB0071D01, 1, lock, reader, scan,
                            done ? static_cast<uint8_t>(tags.size()) : 0, done ? scanReader : '-'));
  }
};

struct CellRig {
  FakePlatform platform;
  FakePort port;
  CellLink link{1, port, platform};
  FakeCell cell;

  // One full poll: the hub asks, the cell answers 6 ms later (or stays silent), the reply window
  // closes, and the clock reaches the next poll.
  void poll() {
    link.loop();
    platform.now += 6;
    cell.answer(port, platform.now);
    link.loop();
    platform.now += CELL_REPLY_TIMEOUT_MS - 6;
    link.loop();
    assert(port.tx.empty());  // no second request inside one poll period
    platform.now += CELL_POLL_INTERVAL_MS - CELL_REPLY_TIMEOUT_MS;
  }
  void answer(uint8_t address = 1, char lock = 'L', char reader = 'H') {
    cell.silent = false;
    cell.address = address;
    cell.lock = lock;
    cell.reader = reader;
    poll();
  }
  void silence() {
    cell.silent = true;
    poll();
  }
};

void cellFrameFormat() {
  uint32_t seq;
  assert(cellframe::crc16("123456789", 9) == 0x29B1);  // CRC-16/CCITT-FALSE check value
  char frame[cellframe::MAX_LINE];
  size_t n = cellframe::encodePing(0x1A, frame, sizeof(frame));
  assert(n == 16 && strncmp(frame, "P,0000001A,", 11) == 0 && frame[15] == '\n');

  std::string reply = replyFrame(0xDEADBEEF, 2, 0x01020304, 0x0F, 'U', 'F');
  assert(reply.size() == 39 && reply.compare(0, 34, "R,DEADBEEF,02,01020304,0F,UF,I00-,") == 0);
  std::vector<char> buf(reply.begin(), reply.end() - 1);
  buf.push_back('\0');
  assert(cellframe::unseal(buf.data()));
  cellframe::Reply r;
  assert(cellframe::parseReply(buf.data(), &r));
  assert(r.seq == 0xDEADBEEF && r.cellAddress == 2 && r.bootId == 0x01020304 && r.resetCode == 0x0F);
  assert(r.lock == 'U' && r.reader == 'F');

  char corrupted[] = "R,DEADBEEF,02,01020304,0E,UF,I00-,0000";
  assert(!cellframe::unseal(corrupted));
  char lower[] = "R,deadbeef,02,01020304,0F,LH,I00-";
  assert(!cellframe::parseReply(lower, &r));
  char version2[] = "R,DEADBEEF,02,01020304,0F,LH";  // a cell still on frame version 2
  assert(!cellframe::parseReply(version2, &r));
  char badState[] = "R,DEADBEEF,02,01020304,0F,XH,I00-";
  assert(!cellframe::parseReply(badState, &r));
  char unknown[] = "R,DEADBEEF,02,01020304,0F,??,I00-";
  assert(cellframe::parseReply(unknown, &r) && r.lock == '?' && r.reader == '?' && r.scan == 'I');
  char done[] = "R,DEADBEEF,02,01020304,0F,LH,D02F";
  assert(cellframe::parseReply(done, &r) && r.scan == 'D' && r.tagCount == 2 && r.scanReader == 'F');
  char runningWithTags[] = "R,DEADBEEF,02,01020304,0F,LH,W01H";  // only a finished window has tags
  assert(!cellframe::parseReply(runningWithTags, &r));
  char tooManyTags[] = "R,DEADBEEF,02,01020304,0F,LH,D09H";
  assert(!cellframe::parseReply(tooManyTags, &r));
  assert(cellframe::encodeReply(cellframe::Reply{1, 1, 1, 1, 'X', 'H'}, frame, sizeof(frame)) == 0);

  // SCAN, TAG? and TAG
  n = cellframe::encodeScan(0x1B, frame, sizeof(frame));
  assert(n == 16 && strncmp(frame, "S,0000001B,", 11) == 0);
  n = cellframe::encodeTagRequest(0x1C, 3, frame, sizeof(frame));
  assert(n == 19 && strncmp(frame, "T,0000001C,03,", 14) == 0);
  std::string tag = tagFrame(0x1D, 1, 0, "E2004717CCC06422C2B80112", 30);
  assert(tag.compare(0, 46, "E,0000001D,01,00,001E,E2004717CCC06422C2B80112") == 0);
  std::vector<char> tbuf(tag.begin(), tag.end() - 1);
  tbuf.push_back('\0');
  assert(cellframe::unseal(tbuf.data()));
  uint8_t address, index;
  cellframe::Tag parsed;
  assert(cellframe::parseTag(tbuf.data(), &seq, &address, &index, &parsed));
  assert(seq == 0x1D && address == 1 && index == 0 && parsed.readCount == 30);
  assert(strcmp(parsed.epc, "E2004717CCC06422C2B80112") == 0);
  char oddEpc[] = "E,0000001D,01,00,001E,E20";
  assert(!cellframe::parseTag(oddEpc, &seq, &address, &index, &parsed));
  char lowerEpc[] = "E,0000001D,01,00,001E,e200";
  assert(!cellframe::parseTag(lowerEpc, &seq, &address, &index, &parsed));
  std::string longest = tagFrame(1, 1, 7, "0123456789ABCDEF0123456789ABCDEF", 65535);
  assert(longest.size() == 60 && longest.size() < cellframe::MAX_LINE);
  char shortPing[] = "P,1A";
  assert(!cellframe::parsePing(shortPing, &seq));
  assert(cellframe::seal("P,0000001A", frame, 8) == 0);  // never truncates a frame
}

void lineReaderDropsOversizedLines() {
  cellframe::LineReader reader;
  for (size_t i = 0; i < cellframe::MAX_LINE + 10; i++) assert(!reader.push('X'));
  assert(reader.push('\n') && reader.overflowed && reader.buf[0] == '\0');
  reader.clearOverflow();
  for (char c : std::string("P,1\r")) assert(!reader.push(c));
  assert(reader.push('\n') && !reader.overflowed && strcmp(reader.buf, "P,1") == 0);
}

void cellIsUnknownThenConnected() {
  CellRig r;
  assert(strcmp(r.link.connectionStatus(), "UNKNOWN") == 0);
  r.answer();
  assert(strcmp(r.link.connectionStatus(), "CONNECTED") == 0);
}

void cellIsDisconnectedAfterThreeMissesAndRecovers() {
  CellRig r;
  r.silence();
  r.silence();
  assert(strcmp(r.link.connectionStatus(), "UNKNOWN") == 0);
  r.silence();
  assert(strcmp(r.link.connectionStatus(), "DISCONNECTED") == 0);

  r.answer();
  assert(strcmp(r.link.connectionStatus(), "CONNECTED") == 0);
  r.silence();
  r.silence();
  assert(strcmp(r.link.connectionStatus(), "CONNECTED") == 0);  // two misses are tolerated
  r.silence();
  assert(strcmp(r.link.connectionStatus(), "DISCONNECTED") == 0);
}

void cellOnTheWrongPortIsDisconnected() {
  CellRig r;
  r.answer();
  r.answer(2);  // A2's cable plugged into port 1
  assert(strcmp(r.link.connectionStatus(), "DISCONNECTED") == 0);
  r.answer(2);
  assert(strcmp(r.link.connectionStatus(), "DISCONNECTED") == 0);
  r.answer(1);
  assert(strcmp(r.link.connectionStatus(), "CONNECTED") == 0);
}

void staleEchoedAndCorruptedFramesNeverCount() {
  CellRig r;
  r.link.loop();
  uint32_t seq = lastPing(r.port);
  r.platform.now += 6;
  char echo[cellframe::MAX_LINE];
  r.port.receive(std::string(echo, cellframe::encodePing(seq, echo, sizeof(echo))));  // our own PING read back
  r.port.receive(replyFrame(seq - 1, 1));                                              // answer to an older PING
  std::string corrupted = replyFrame(seq, 1);
  corrupted[12] = '7';  // address byte flipped after the CRC was computed
  r.port.receive(corrupted);
  r.port.receive("garbage without crc\n");
  r.link.loop();
  assert(strcmp(r.link.connectionStatus(), "UNKNOWN") == 0);

  // A late answer after the window closed never counts either.
  r.platform.now += CELL_REPLY_TIMEOUT_MS;
  r.link.loop();  // miss recorded, no new PING yet
  r.port.receive(replyFrame(seq, 1));
  r.link.loop();
  assert(strcmp(r.link.connectionStatus(), "UNKNOWN") == 0);
}

void replyHeldByABusyLoopStillCounts() {
  CellRig r;
  r.link.loop();
  uint32_t seq = lastPing(r.port);
  r.port.receive(replyFrame(seq, 1));  // arrived on time, read only after the loop was held
  r.platform.now += CELL_REPLY_TIMEOUT_MS + 40;
  r.link.loop();
  assert(strcmp(r.link.connectionStatus(), "CONNECTED") == 0);
}

void pingsArePacedAndNeverOverlap() {
  CellRig r;
  r.link.loop();
  uint32_t first = lastPing(r.port);
  r.platform.now += CELL_REPLY_TIMEOUT_MS - 1;
  r.link.loop();
  assert(r.port.tx.empty());  // still waiting for the first answer
  r.platform.now = CELL_POLL_INTERVAL_MS - 1;
  r.link.loop();
  assert(r.port.tx.empty());
  r.platform.now = CELL_POLL_INTERVAL_MS;
  r.link.loop();
  assert(lastPing(r.port) == first + 1);
}

void portsAreIndependent() {
  FakePlatform platform;
  FakePort port1, port2;
  CellLink a1(1, port1, platform), a2(2, port2, platform);
  for (int i = 0; i < 3; i++) {
    a1.loop();
    a2.loop();
    uint32_t seq = lastPing(port1);
    port2.tx.clear();
    platform.now += 6;
    port1.receive(replyFrame(seq, 1));
    a1.loop();
    a2.loop();
    platform.now += CELL_REPLY_TIMEOUT_MS - 6;
    a1.loop();
    a2.loop();
    platform.now += CELL_POLL_INTERVAL_MS - CELL_REPLY_TIMEOUT_MS;
  }
  assert(strcmp(a1.connectionStatus(), "CONNECTED") == 0);
  assert(strcmp(a2.connectionStatus(), "DISCONNECTED") == 0);
}

void cellReportsItsLatchAndReader() {
  CellRig r;
  assert(strcmp(r.link.lockState(), "UNKNOWN") == 0 && strcmp(r.link.readerStatus(), "UNKNOWN") == 0);
  r.answer(1, 'L', 'H');
  assert(strcmp(r.link.lockState(), "LOCKED") == 0 && strcmp(r.link.readerStatus(), "HEALTHY") == 0);
  r.answer(1, 'U', 'F');
  assert(strcmp(r.link.lockState(), "UNLOCKED") == 0 && strcmp(r.link.readerStatus(), "FAULTED") == 0);
  r.answer(1, '?', 'H');
  assert(strcmp(r.link.lockState(), "UNKNOWN") == 0);
}

void silentOrForeignCellStateIsNeverReported() {
  CellRig r;
  r.answer(1, 'L', 'H');
  r.silence();
  r.silence();
  assert(strcmp(r.link.lockState(), "LOCKED") == 0);  // still CONNECTED after two misses
  r.silence();
  assert(strcmp(r.link.lockState(), "UNKNOWN") == 0 && strcmp(r.link.readerStatus(), "UNKNOWN") == 0);

  r.answer(1, 'L', 'H');
  r.answer(2, 'U', 'H');  // A2 on port 1: its latch must not be reported as A1's
  assert(strcmp(r.link.lockState(), "UNKNOWN") == 0 && strcmp(r.link.readerStatus(), "UNKNOWN") == 0);
}

CellObservation fakeCellStatus(int cellAddress) {
  if (cellAddress == 1) return {"CONNECTED", "HEALTHY", "LOCKED"};
  return {"DISCONNECTED", "UNKNOWN", "UNKNOWN"};
}

void heartbeatReportsEachCell() {
  Rig r;
  r.hub.cellStatus(fakeCellStatus);
  r.connectOnce();
  const Message& heartbeat = r.transport.published.back();
  assert(has(heartbeat, "\"type\":\"HEARTBEAT\""));
  assert(has(heartbeat, "\"cellAddress\":1,\"connectionStatus\":\"CONNECTED\",\"readerStatus\":\"HEALTHY\","
                        "\"doorState\":\"UNKNOWN\",\"lockState\":\"LOCKED\""));
  assert(has(heartbeat, "\"cellAddress\":2,\"connectionStatus\":\"DISCONNECTED\",\"readerStatus\":\"UNKNOWN\","
                        "\"doorState\":\"UNKNOWN\",\"lockState\":\"UNKNOWN\""));
}

void heartbeatWithoutSourceIsUnknown() {
  Rig r;
  r.connectOnce();
  assert(has(r.transport.published.back(), "\"connectionStatus\":\"UNKNOWN\",\"readerStatus\":\"UNKNOWN\","
                                           "\"doorState\":\"UNKNOWN\",\"lockState\":\"UNKNOWN\""));
}

// Polls until the link hands over a scan, at most `limit` polls.
bool pollUntilScan(CellRig& r, ScanResult* out, int limit = 60) {
  for (int i = 0; i < limit; i++) {
    r.poll();
    if (r.link.takeScan(out)) return true;
  }
  return false;
}

void firstScanStartsOnceConnectedAndFetchesEveryTag() {
  CellRig r;
  r.cell.tags = {{"E2004717CCC06422C2B80112", 30}, {"E28011700000020000000001", 2}};
  ScanResult scan;
  assert(pollUntilScan(r, &scan));
  assert(r.cell.scansStarted == 1);
  assert(scan.reader == 'H' && scan.tagCount == 2);
  assert(strcmp(scan.tags[0].epc, "E2004717CCC06422C2B80112") == 0 && scan.tags[0].readCount == 30);
  assert(strcmp(scan.tags[1].epc, "E28011700000020000000001") == 0 && scan.tags[1].readCount == 2);
  assert(scan.endedMs - scan.startedMs >= 3000 && scan.endedMs - scan.startedMs < 3300);
  assert(!r.link.takeScan(&scan));  // handed over once
  assert(strcmp(r.link.connectionStatus(), "CONNECTED") == 0);
}

void emptyAndFaultedWindowsAreReportedToo() {
  CellRig r;
  r.cell.scanReader = 'F';
  ScanResult scan;
  assert(pollUntilScan(r, &scan));
  assert(scan.reader == 'F' && scan.tagCount == 0);
}

void nextScanAfterThirtySecondsOrWhenTheLatchCloses() {
  CellRig r;
  ScanResult scan;
  assert(pollUntilScan(r, &scan));
  for (int i = 0; i < 100; i++) r.answer(1, 'L');  // 10 s, latch stays locked
  assert(r.cell.scansStarted == 1);
  r.answer(1, 'U');
  r.answer(1, 'L');  // the striker is pushed in
  r.poll();
  assert(r.cell.scansStarted == 2);
  assert(pollUntilScan(r, &scan));
  for (int i = 0; i < 400 && r.cell.scansStarted == 2; i++) r.poll();
  assert(r.cell.scansStarted == 3);  // the 30 s monitoring scan
}

void scanIsAbandonedWhenTheLinkDrops() {
  CellRig r;
  r.cell.tags = {{"E2004717CCC06422C2B80112", 30}};
  for (int i = 0; i < 5; i++) r.poll();  // connected, window running
  assert(r.cell.scan == 'W');
  r.silence();
  r.silence();
  r.silence();
  assert(strcmp(r.link.connectionStatus(), "DISCONNECTED") == 0);
  ScanResult scan;
  for (int i = 0; i < 40; i++) {
    r.silence();
    assert(!r.link.takeScan(&scan));
  }
}

void tagFromAnotherCellOrIndexNeverCounts() {
  CellRig r;
  r.cell.tags = {{"E2004717CCC06422C2B80112", 30}};
  ScanResult scan;
  // Run until the hub asks for the first tag, then answer as A2 and with the wrong index.
  for (int i = 0; i < 60; i++) {
    r.link.loop();
    std::string sent = r.port.tx;
    if (!sent.empty() && sent[0] == 'T') {
      Request q = lastRequest(r.port);
      r.port.receive(tagFrame(q.seq, 2, 0, "E2004717CCC06422C2B80112", 30));
      r.port.receive(tagFrame(q.seq, 1, 1, "E2004717CCC06422C2B80112", 30));
      r.platform.now += CELL_POLL_INTERVAL_MS;
      r.link.loop();
      assert(!r.link.takeScan(&scan));
      break;
    }
    r.platform.now += 6;
    r.cell.answer(r.port, r.platform.now);
    r.link.loop();
    r.platform.now += CELL_POLL_INTERVAL_MS - 6;
  }
  assert(pollUntilScan(r, &scan));  // asked again, then answered properly
  assert(scan.tagCount == 1 && scan.tags[0].readCount == 30);
}

ScanResult sampleScan(FakePlatform& platform) {
  ScanResult scan;
  scan.startedMs = platform.now - 4000;
  scan.endedMs = platform.now - 1000;
  scan.reader = 'H';
  scan.tagCount = 1;
  strcpy(scan.tags[0].epc, "E2004717CCC06422C2B80112");
  scan.tags[0].readCount = 30;
  return scan;
}

void scanIsPublishedAsRfidScanCompleted() {
  Rig r;
  r.platform.now = 100000;
  assert(!r.hub.publishScan(1, sampleScan(r.platform)));  // not online yet: dropped, never queued
  r.connectOnce();
  size_t before = r.transport.published.size();
  assert(r.hub.publishScan(1, sampleScan(r.platform)));
  assert(r.transport.published.size() == before + 1);
  const Message& m = r.transport.published.back();
  assert(strcmp(m.topic, "aegis/v1/lockers/d46a74ae-39dc-460b-8af0-38fc791b376a/events") == 0);
  assert(m.qos == 1 && !m.retain);
  assert(has(m, "\"type\":\"RFID_SCAN_COMPLETED\""));
  assert(has(m, "\"compartmentId\":\"1ae77ae3-8490-4f09-9412-a7816b77bff9\""));
  assert(has(m, "\"windowStartedAt\":\"2026-09-10T00:26:36Z\",\"windowEndedAt\":\"2026-09-10T00:26:39Z\""));
  assert(has(m, "\"readerStatus\":\"HEALTHY\",\"observedIdentifiers\":[{\"identifierType\":\"RFID_UHF\","
                "\"identifierValue\":\"E2004717CCC06422C2B80112\",\"readCount\":30}]}"));
  assert(!has(m, "operationId"));  // outside an operation (§20)
  assert(!r.hub.publishScan(9, sampleScan(r.platform)));  // no such cell
}

void fullScanFitsTheMessage() {
  Rig r;
  r.connectOnce();
  ScanResult scan = sampleScan(r.platform);
  scan.tagCount = cellframe::MAX_SCAN_TAGS;
  for (auto& t : scan.tags) {
    strcpy(t.epc, "0123456789ABCDEF0123456789ABCDEF");
    t.readCount = 65535;
  }
  assert(r.hub.publishScan(1, scan));
}

// ---------------------------------------------------------------- hub screen (doc 10 §27)
// Every display message below is fictitious: the token is a made-up 43-character value.

const char* FAKE_TOKEN = "FICTITIOUS-test-token-not-a-real-secret-000";
const char* A1 = "1ae77ae3-8490-4f09-9412-a7816b77bff9";
const char* OP = "2f38d3b6-c18f-4a74-aa9a-2d574286013f";
const char* CHALLENGE = "9d65cbae-4610-4e40-a314-3b93af07be9c";

struct FakeDisplay : Display {
  bool screen = true;
  bool drawFails = false;
  int draws = 0;
  int statuses = 0;
  int clears = 0;
  bool qrOnScreen = false;
  std::string lastUri;
  std::string lastStatus;
  bool available() override { return screen; }
  uint16_t lastTtlMs = 0;
  DrawState drawState() override { return DrawState::Drawn; }  // draws synchronously
  bool showChallenge(const char* uri, const char*, const char*, uint16_t ttlMs) override {
    lastTtlMs = ttlMs;
    if (drawFails) return false;
    draws++;
    lastUri = uri;
    qrOnScreen = true;
    return true;
  }
  bool showStatus(const char*, const char*, const char* status, uint16_t ttlMs) override {
    lastTtlMs = ttlMs;
    statuses++;
    lastStatus = status;
    qrOnScreen = false;
    return true;
  }
  void clear() override {
    clears++;
    qrOnScreen = false;
  }
};

// A fictitious instruction, issued `age` seconds ago and valid for `life` seconds from issue.
Message challengeMessage(int64_t nowUnix, const std::string& session, const char* messageId, uint64_t revision,
                       int64_t age, int64_t life, const char* locker = LOCKER, const char* token = FAKE_TOKEN,
                       const char* compartment = A1) {
  char issued[INSTANT_LEN], expires[INSTANT_LEN];
  formatInstant(nowUnix - age, issued);
  formatInstant(nowUnix - age + life, expires);
  Message m{};
  snprintf(m.topic, sizeof(m.topic), "aegis/v1/lockers/%s/display", LOCKER);
  snprintf(m.payload, sizeof(m.payload),
           "{\"schemaVersion\":\"3.0\",\"messageId\":\"%s\",\"type\":\"DISPLAY_ACCESS_CHALLENGE\","
           "\"lockerId\":\"%s\",\"compartmentId\":\"%s\",\"operationId\":\"%s\",\"targetDeviceSessionId\":\"%s\","
           "\"displayRevision\":%llu,\"issuedAt\":\"%s\",\"expiresAt\":\"%s\",\"payload\":{\"challengeId\":\"%s\","
           "\"action\":\"CHECKOUT\",\"compartmentCode\":\"A1\",\"token\":\"%s\"}}",
           messageId, locker, compartment, OP, session.c_str(),
           static_cast<unsigned long long>(revision), issued, expires, CHALLENGE, token);
  m.qos = 1;
  return m;
}
Message statusMessage(int64_t nowUnix, const std::string& session, const char* messageId, uint64_t revision,
                    const char* code) {
  char issued[INSTANT_LEN], expires[INSTANT_LEN];
  formatInstant(nowUnix, issued);
  formatInstant(nowUnix + 30, expires);
  Message m{};
  snprintf(m.topic, sizeof(m.topic), "aegis/v1/lockers/%s/display", LOCKER);
  snprintf(m.payload, sizeof(m.payload),
           "{\"schemaVersion\":\"3.0\",\"messageId\":\"%s\",\"type\":\"DISPLAY_OPERATION_STATUS\","
           "\"lockerId\":\"%s\",\"compartmentId\":\"%s\",\"operationId\":\"%s\",\"targetDeviceSessionId\":\"%s\","
           "\"displayRevision\":%llu,\"issuedAt\":\"%s\",\"expiresAt\":\"%s\",\"payload\":{\"action\":\"CHECKOUT\","
           "\"compartmentCode\":\"A1\",\"status\":\"%s\",\"reasonCode\":null}}",
           messageId, LOCKER, A1, OP, session.c_str(), static_cast<unsigned long long>(revision), issued, expires,
           code);
  m.qos = 1;
  return m;
}

struct DisplayRig {
  FakePlatform platform;
  FakeTransport transport;
  FakeDisplay screen;
  DisplayInbox inbox{CONFIG, screen};
  HubLink hub{CONFIG, transport, platform};

  DisplayRig() {
    platform.network = true;
    platform.synced = true;
    inbox.begin();
    hub.display(&inbox);
    assert(hub.begin());
    hub.loop();
    transport.events.push_back(Transport::Event::Connected);
    hub.loop();
    transport.published.clear();
  }
  std::string session() const { return hub.deviceSessionId(); }

  Message challenge(const char* messageId, uint64_t revision, int64_t age = 0, int64_t life = 60,
                    const std::string& target = "", const char* locker = LOCKER, const char* token = FAKE_TOKEN,
                    const char* compartment = A1) {
    return challengeMessage(platform.unix, target.empty() ? session() : target, messageId, revision, age, life, locker,
                            token, compartment);
  }
  Message status(const char* messageId, uint64_t revision, const char* code = "EXPIRED") {
    return statusMessage(platform.unix, session(), messageId, revision, code);
  }
  // Delivers one message and returns what the hub published for it.
  std::vector<Message> deliver(const Message& m) {
    transport.published.clear();
    transport.inbound.push_back(m);
    hub.loop();
    return transport.published;
  }
};

const char* M1 = "fd6c4a94-4ac4-4a91-9249-59347c3b6481";
const char* M2 = "fd6c4a94-4ac4-4a91-9249-59347c3b6482";
const char* M3 = "fd6c4a94-4ac4-4a91-9249-59347c3b6483";

void noTokenAnywhere(const DisplayRig& r) {
  for (const Message& m : r.transport.published) assert(strstr(m.payload, FAKE_TOKEN) == nullptr);
  for (const std::string& line : r.platform.logs) assert(line.find(FAKE_TOKEN) == std::string::npos);
}

void displayIsSubscribedOnEveryConnection() {
  DisplayRig r;
  bool found = false;
  for (const std::string& s : r.transport.subscriptions) {
    found = found || s == "aegis/v1/lockers/d46a74ae-39dc-460b-8af0-38fc791b376a/display@1";
  }
  assert(found);
  Rig plain;  // a hub without a screen inbox never reads `display`
  plain.connectOnce();
  for (const std::string& s : plain.transport.subscriptions) assert(s.find("/display") == std::string::npos);
}

void challengeIsAcknowledgedOnlyAfterItIsDrawn() {
  DisplayRig r;
  std::vector<Message> out = r.deliver(r.challenge(M1, 41));
  assert(r.screen.draws == 1 && r.screen.qrOnScreen);
  assert(r.screen.lastUri == std::string("aegis://local-access?v=1&challengeId=") + CHALLENGE + "&operationId=" + OP +
                                 "&lockerId=" + LOCKER + "&token=" + FAKE_TOKEN);
  assert(out.size() == 1);
  const Message& ack = out[0];
  assert(strcmp(ack.topic, "aegis/v1/lockers/d46a74ae-39dc-460b-8af0-38fc791b376a/events") == 0 && ack.qos == 1);
  assert(field(ack, "type") == "ACCESS_CHALLENGE_DISPLAYED");
  assert(field(ack, "displayMessageId") == M1 && field(ack, "challengeId") == CHALLENGE);
  assert(field(ack, "operationId") == OP && field(ack, "compartmentId") == A1);
  assert(field(ack, "deviceSessionId") == r.session());
  assert(has(ack, "\"displayRevision\":41}"));
  assert(r.screen.lastTtlMs == 60000);
  noTokenAnywhere(r);

  DisplayRig failing;
  failing.screen.drawFails = true;
  out = failing.deliver(failing.challenge(M1, 41));
  assert(out.size() == 1 && field(out[0], "type") == "DISPLAY_REJECTED");
  assert(field(out[0], "reason") == "SCREEN_UNAVAILABLE" && field(out[0], "challengeId") == CHALLENGE);
  assert(!failing.screen.qrOnScreen);

  DisplayRig noScreen;
  noScreen.screen.screen = false;
  out = noScreen.deliver(noScreen.challenge(M1, 41));
  assert(field(out[0], "reason") == "SCREEN_UNAVAILABLE" && noScreen.screen.draws == 0);
}

void deadlineIsKeptLocallyAndNeverExtended() {
  DisplayRig r;
  r.deliver(r.challenge(M1, 41, 0, 45));  // backend shortened the window to 45 s
  r.platform.unix += 44;
  r.hub.loop();
  assert(r.screen.qrOnScreen);
  r.platform.unix += 1;
  r.hub.loop();
  assert(!r.screen.qrOnScreen);  // cleared at expiresAt with no clearing message

  DisplayRig capped;
  capped.deliver(capped.challenge(M1, 41, 0, 600));  // a deadline past the 60 s maximum is capped
  capped.platform.unix += 60;
  capped.hub.loop();
  assert(!capped.screen.qrOnScreen);

  DisplayRig late;
  std::vector<Message> out = late.deliver(late.challenge(M1, 41, 61, 600));  // issued 61 s ago: no new 60 s
  assert(field(out[0], "reason") == "DISPLAY_EXPIRED" && late.screen.draws == 0);
  out = late.deliver(late.challenge(M2, 42, 70, 60));
  assert(field(out[0], "reason") == "DISPLAY_EXPIRED");
}

void duplicateReplaysItsAnswerWithoutRedrawing() {
  DisplayRig r;
  Message m = r.challenge(M1, 41);
  std::string first = field(r.deliver(m)[0], "type");
  r.platform.unix += 70;  // even after the QR expired and was cleared
  r.hub.loop();
  std::vector<Message> again = r.deliver(m);
  assert(first == "ACCESS_CHALLENGE_DISPLAYED" && again.size() == 1);
  assert(field(again[0], "type") == "ACCESS_CHALLENGE_DISPLAYED" && field(again[0], "displayMessageId") == M1);
  assert(r.screen.draws == 1 && !r.screen.qrOnScreen);  // not drawn again, validity not extended

  DisplayRig refused;
  Message other = refused.challenge(M1, 41, 0, 60, "", "00000000-0000-4000-8000-00000000dead");
  refused.deliver(other);
  std::vector<Message> replay = refused.deliver(other);
  assert(field(replay[0], "reason") == "INVALID_DISPLAY_PAYLOAD");
}

void staleRevisionNeverReplacesTheScreen() {
  DisplayRig r;
  r.deliver(r.challenge(M1, 41));
  int clears = r.screen.clears;
  std::vector<Message> out = r.deliver(r.challenge(M2, 41));  // same revision, new messageId
  assert(field(out[0], "type") == "DISPLAY_REJECTED" && field(out[0], "reason") == "STALE_DISPLAY_REVISION");
  out = r.deliver(r.challenge(M3, 40));
  assert(field(out[0], "reason") == "STALE_DISPLAY_REVISION");
  assert(r.screen.draws == 1 && r.screen.qrOnScreen && r.screen.clears == clears);  // the valid QR stays

  out = r.deliver(r.challenge("fd6c4a94-4ac4-4a91-9249-59347c3b6484", 42));  // a newer challenge replaces it
  assert(field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED" && r.screen.draws == 2);
}

void invalidInstructionsAreRefusedAndKeepTheScreen() {
  DisplayRig r;
  r.deliver(r.challenge(M1, 41));
  std::vector<Message> out =
      r.deliver(r.challenge(M2, 42, 0, 60, "00000000-0000-4000-8000-0000000000ff"));  // another boot
  assert(field(out[0], "reason") == "TARGET_SESSION_MISMATCH");
  out = r.deliver(r.challenge(M3, 43, 0, 60, "", "00000000-0000-4000-8000-00000000dead"));
  assert(field(out[0], "reason") == "INVALID_DISPLAY_PAYLOAD");
  out = r.deliver(r.challenge("fd6c4a94-4ac4-4a91-9249-59347c3b6486", 44, 0, 60, "", LOCKER, "too-short"));
  assert(field(out[0], "reason") == "INVALID_DISPLAY_PAYLOAD");
  out = r.deliver(r.challenge("fd6c4a94-4ac4-4a91-9249-59347c3b6485", 45, 0, 60, "", LOCKER, FAKE_TOKEN,
                              "00000000-0000-4000-8000-0000000000a9"));
  assert(field(out[0], "reason") == "INVALID_DISPLAY_PAYLOAD");
  assert(r.screen.draws == 1 && r.screen.qrOnScreen);

  DisplayRig unsynced;
  unsynced.platform.synced = false;
  out = unsynced.deliver(unsynced.challenge(M1, 41));
  assert(field(out[0], "reason") == "SCREEN_UNAVAILABLE");
  noTokenAnywhere(r);
}

void statusReplacesTheQrWithoutAcknowledgement() {
  DisplayRig r;
  r.deliver(r.challenge(M1, 41));
  std::vector<Message> out = r.deliver(r.status(M2, 42, "EXPIRED"));
  assert(out.empty());  // no positive acknowledgement (§27.3)
  assert(r.screen.statuses == 1 && r.screen.lastStatus == "EXPIRED" && !r.screen.qrOnScreen);
  int clears = r.screen.clears;
  r.platform.unix += 29;
  r.hub.loop();
  assert(r.screen.clears == clears);
  r.platform.unix += 1;
  r.hub.loop();
  assert(r.screen.clears == clears + 1);  // back to the idle screen after 30 s
  out = r.deliver(r.status(M3, 42));       // a stale status is refused, without challengeId
  assert(field(out[0], "reason") == "STALE_DISPLAY_REVISION" && !has(out[0], "challengeId"));
}

void lostConnectionAndRebootClearTheQr() {
  DisplayRig r;
  r.deliver(r.challenge(M1, 41));
  r.transport.events.push_back(Transport::Event::Disconnected);
  r.hub.loop();
  assert(!r.screen.qrOnScreen);

  FakeDisplay screen;
  screen.qrOnScreen = true;
  DisplayInbox fresh(CONFIG, screen);
  fresh.begin();
  assert(!screen.qrOnScreen);
}

void unreadableDisplayMessagesAreReportedInvalid() {
  DisplayRig r;
  Message retained = r.challenge(M1, 41);
  retained.retain = true;
  std::vector<Message> out = r.deliver(retained);
  assert(out.size() == 1 && field(out[0], "errorCode") == "INBOUND_MESSAGE_INVALID");
  assert(has(out[0], "retained display message"));
  r.platform.now += INBOUND_REPORT_WINDOW_MS;
  Message garbled = r.challenge(M2, 42);
  strcpy(garbled.payload, "{\"messageId\":\"not-a-uuid\"}");
  out = r.deliver(garbled);  // the clock moved 60 s, so a heartbeat may go out too
  bool reported = false;
  for (const Message& m : out) reported = reported || has(m, "uncorrelable display message");
  assert(reported);
  assert(r.screen.draws == 0);
}

// ---------------------------------------------------------------- display node link (I2C, ADR-019)

namespace df = aegis::displayframe;

// A scripted CYD: decodes what the hub writes and answers the status a real node would.
struct FakeCyd : I2cBus {
  const uint32_t* clock;
  uint32_t bootId = 0xB0071D01;
  uint32_t drawDelayMs = 50;
  int nackWrites = 0;          // the next writes are NACKed
  int badCrcShows = 0;         // the next show frames are reported BAD_CRC
  bool silent = false;         // nobody on the bus: writes NACK, reads return nothing
  bool readsFF = false;        // an unpowered slave
  bool corruptStatus = false;
  bool staleSeq = false;       // reports the frame before the last one
  bool drawFails = false;
  int transactions = 0;
  int draws = 0;
  std::vector<uint32_t> resets;
  std::vector<std::vector<uint8_t>> frames;  // writes the CYD acknowledged
  uint32_t seq = 0;
  uint8_t state = df::IDLE;
  uint8_t err = df::NONE;
  uint32_t drawAt = 0;
  bool anyShown = false;
  uint32_t shownSeq = 0;

  explicit FakeCyd(const uint32_t* c) : clock(c) {}
  bool write(uint8_t address, const uint8_t* d, size_t n) override {
    transactions++;
    if (silent || address != 0x42) return false;
    if (nackWrites > 0) {
      nackWrites--;
      return false;
    }
    frames.emplace_back(d, d + n);
    df::Command c;
    df::Err e = df::decodeCommand(d, n, &c);
    if (e == df::NONE && df::isShow(c.cmd) && badCrcShows > 0) {
      badCrcShows--;
      e = df::BAD_CRC;
    }
    seq = n >= 7 ? df::getU32(d + 3) : 0;
    err = e;
    if (e != df::NONE) {
      state = df::FAILED;
    } else if (c.cmd == df::CLEAR) {
      state = df::IDLE;
    } else if (df::isShow(c.cmd) && !(anyShown && c.seq == shownSeq)) {  // the same seq never redraws
      draws++;
      state = df::DRAWING;
      drawAt = *clock + drawDelayMs;
    }
    return true;
  }
  size_t read(uint8_t address, uint8_t* buf, size_t n) override {
    transactions++;
    if (silent || address != 0x42) return 0;
    if (readsFF) {
      memset(buf, 0xFF, n);
      return n;
    }
    if (state == df::DRAWING && *clock >= drawAt) {
      state = drawFails ? df::FAILED : df::SHOWN;
      err = drawFails ? df::DRAW_FAILED : df::NONE;
      anyShown = !drawFails;
      shownSeq = seq;
    }
    uint8_t out[df::STATUS_LEN];
    df::encodeStatus(df::Status{1, 3, bootId, staleSeq ? seq - 1 : seq, state, err}, out);
    if (corruptStatus) out[15] ^= 1;
    size_t k = n < sizeof(out) ? n : sizeof(out);
    memcpy(buf, out, k);
    return k;
  }
  void reset() override { resets.push_back(*clock); }
  int count(uint8_t cmd) const {
    int k = 0;
    for (const auto& f : frames) k += f[2] == cmd;
    return k;
  }
  df::Command last(uint8_t cmd) const {
    df::Command c = {};
    for (const auto& f : frames) {
      if (f[2] == cmd) assert(df::decodeCommand(f.data(), f.size(), &c) == df::NONE);
    }
    return c;
  }
};

bool holds(const void* object, size_t size, const char* text) {
  const char* b = static_cast<const char*>(object);
  const size_t n = strlen(text);
  for (size_t i = 0; i + n <= size; i++) {
    if (memcmp(b + i, text, n) == 0) return true;
  }
  return false;
}

// The real chain: HubLink -> DisplayInbox -> I2cDisplay -> scripted CYD.
struct I2cRig {
  FakePlatform platform;
  FakeTransport transport;
  FakeCyd cyd{&platform.now};
  I2cDisplay screen{cyd, platform, 0x42};
  DisplayInbox inbox{CONFIG, screen};
  HubLink hub{CONFIG, transport, platform};

  I2cRig() {
    platform.network = true;
    platform.synced = true;
    inbox.begin();
    hub.display(&inbox);
    assert(hub.begin());
    hub.loop();
    transport.events.push_back(Transport::Event::Connected);
    hub.loop();
    run(50);
    assert(screen.available());
    transport.published.clear();
  }
  // One pass of the sketch's loop: never more than one bus transaction.
  void step(uint32_t ms = 10) {
    platform.now += ms;
    const int before = cyd.transactions;
    screen.loop();
    assert(cyd.transactions - before <= 1);
    hub.loop();
  }
  void run(uint32_t ms) {
    for (uint32_t t = 0; t < ms; t += 10) step();
  }
  Message challenge(const char* messageId, uint64_t revision, int64_t life = 60) {
    return challengeMessage(platform.unix, hub.deviceSessionId(), messageId, revision, 0, life);
  }
  std::vector<Message> deliver(const Message& m) {
    transport.published.clear();
    transport.inbound.push_back(m);
    hub.loop();
    return answers();
  }
  // The display answers published since the last clear (heartbeats left out).
  std::vector<Message> answers() const {
    std::vector<Message> out;
    for (const Message& m : transport.published) {
      if (has(m, "ACCESS_CHALLENGE_DISPLAYED") || has(m, "DISPLAY_REJECTED")) out.push_back(m);
    }
    return out;
  }
  bool logged(const char* fragment) const {
    for (const std::string& line : platform.logs) {
      if (line.find(fragment) != std::string::npos) return true;
    }
    return false;
  }
};

void displayFrameFormat() {
  assert(df::crc16(reinterpret_cast<const uint8_t*>("123456789"), 9) == 0x29B1);
  uint8_t f[df::MAX_FRAME];
  df::Command c = {}, back;

  c.cmd = df::SHOW_CHALLENGE;
  c.seq = 0xA1B2C3D4;
  c.ttlMs = 60000;
  c.action = df::RETURN;
  strcpy(c.code, "A1");
  strcpy(c.text, "aegis://x");
  size_t n = df::encodeCommand(c, f, sizeof(f));
  assert(n == 8 + 4 + 2 + 1 + 9 + 2);
  assert(f[0] == 0xAE && f[1] == 1 && f[2] == 1 && f[3] == 0xD4 && f[6] == 0xA1 && f[7] == n - 10);
  assert(f[8] == 0x60 && f[9] == 0xEA);  // 60000 little endian
  assert(df::decodeCommand(f, n, &back) == df::NONE && back.cmd == df::SHOW_CHALLENGE && back.seq == 0xA1B2C3D4 &&
         back.ttlMs == 60000 && back.action == df::RETURN && strcmp(back.code, "A1") == 0 &&
         strcmp(back.text, "aegis://x") == 0);

  df::Command st = {};
  st.cmd = df::SHOW_STATUS;
  st.seq = 7;
  st.ttlMs = 30000;
  strcpy(st.code, "B12");
  strcpy(st.text, "SOME_FUTURE_STATUS");
  n = df::encodeCommand(st, f, sizeof(f));
  assert(df::decodeCommand(f, n, &back) == df::NONE && back.cmd == df::SHOW_STATUS && back.ttlMs == 30000 &&
         back.action == df::CHECKOUT && strcmp(back.code, "B12") == 0 && strcmp(back.text, "SOME_FUTURE_STATUS") == 0);
  for (uint8_t cmd : {df::CLEAR, df::PING}) {
    df::Command e = {};
    e.cmd = cmd;
    e.seq = 0xFFFFFFFF;
    n = df::encodeCommand(e, f, sizeof(f));
    assert(n == 10 && df::decodeCommand(f, n, &back) == df::NONE && back.cmd == cmd && back.seq == 0xFFFFFFFF);
  }

  // Refused frames: truncated, oversized, wrong version, wrong length, bad CRC, unknown command.
  n = df::encodeCommand(c, f, sizeof(f));
  uint8_t g[df::MAX_FRAME + 1] = {};
  memcpy(g, f, n);
  assert(df::decodeCommand(g, n - 1, &back) == df::BAD_LEN);
  assert(df::decodeCommand(g, n + 1, &back) == df::BAD_LEN);
  assert(df::decodeCommand(g, df::MAX_FRAME + 1, &back) == df::BAD_LEN);
  assert(df::decodeCommand(g, 5, &back) == df::BAD_LEN);
  g[1] = 2;
  assert(df::decodeCommand(g, n, &back) == df::BAD_VERSION);
  g[1] = 1;
  g[7]++;
  assert(df::decodeCommand(g, n, &back) == df::BAD_LEN);
  g[7]--;
  g[n - 1] ^= 1;
  assert(df::decodeCommand(g, n, &back) == df::BAD_CRC);
  g[n - 1] ^= 1;
  g[2] = 9;
  uint16_t crc = df::crc16(g, n - 2);
  g[n - 2] = static_cast<uint8_t>(crc >> 8);
  g[n - 1] = static_cast<uint8_t>(crc);
  assert(df::decodeCommand(g, n, &back) == df::UNKNOWN_CMD);
  // A 231-byte URI built by hand (the encoder never makes one).
  uint8_t big[df::MAX_FRAME] = {0xAE, 1, df::SHOW_CHALLENGE, 1, 0, 0, 0, 2 + 1 + 1 + 1 + 1 + 231, 0x60, 0xEA, 0, 1, 'A', 231};
  memset(big + 14, 'u', 231);
  crc = df::crc16(big, 245);
  big[245] = static_cast<uint8_t>(crc >> 8);
  big[246] = static_cast<uint8_t>(crc);
  assert(df::decodeCommand(big, 247, &back) == df::URI_TOO_LONG);

  // The encoder refuses what breaks a limit.
  df::Command bad = c;
  strcpy(bad.code, "A1234567");
  assert(df::encodeCommand(bad, f, sizeof(f)) > 0);
  memcpy(bad.code, "A12345678", 9);  // 9 characters, no terminator inside the field
  assert(df::encodeCommand(bad, f, sizeof(f)) == 0);
  bad = c;
  strcpy(bad.code, "A\x01");
  assert(df::encodeCommand(bad, f, sizeof(f)) == 0);
  bad = c;
  strcpy(bad.code, "A\xC3\xA9");
  assert(df::encodeCommand(bad, f, sizeof(f)) == 0);
  bad = c;
  bad.ttlMs = 0;
  assert(df::encodeCommand(bad, f, sizeof(f)) == 0);
  bad.ttlMs = 60001;
  assert(df::encodeCommand(bad, f, sizeof(f)) == 0);
  bad = c;
  memset(bad.text, 'u', df::MAX_URI);
  bad.text[df::MAX_URI] = '\0';
  assert(df::encodeCommand(bad, f, sizeof(f)) == 8 + 2 + 1 + 1 + 2 + 1 + 230 + 2);
  bad = st;
  strcpy(bad.text, "ABCDEFGHIJKLMNOPQRSTUVWXY");  // 25 characters
  assert(df::encodeCommand(bad, f, sizeof(f)) == 0);

  // Status: round trip, corrupted CRC, unpowered slave, other version, short read.
  uint8_t s[df::STATUS_LEN];
  df::Status status;
  df::encodeStatus(df::Status{1, 3, 0xB0071D01, 0x01020304, df::SHOWN, df::NONE}, s);
  assert(s[0] == 0xEA && s[3] == 0x01 && s[7] == 0x04);
  assert(df::decodeStatus(s, sizeof(s), &status) && status.bootId == 0xB0071D01 && status.seq == 0x01020304 &&
         status.state == df::SHOWN && status.fwVer == 3);
  assert(!df::decodeStatus(s, sizeof(s) - 1, &status));
  s[15] ^= 1;
  assert(!df::decodeStatus(s, sizeof(s), &status));
  memset(s, 0xFF, sizeof(s));
  assert(!df::decodeStatus(s, sizeof(s), &status));
  df::encodeStatus(df::Status{2, 3, 1, 1, df::IDLE, df::NONE}, s);
  assert(!df::decodeStatus(s, sizeof(s), &status));
}

void challengeUriFitsTheFrame() {
  DisplayInstruction in = {};
  strcpy(in.challengeId, CHALLENGE);
  strcpy(in.operationId, OP);
  strcpy(in.token, FAKE_TOKEN);
  char uri[256];
  assert(challengeUri(in, LOCKER, uri, sizeof(uri)) && strlen(uri) == 218);  // 32-byte token, 43 characters

  FakePlatform p;
  FakeCyd cyd(&p.now);
  I2cDisplay screen(cyd, p, 0x42);
  assert(screen.showChallenge(uri, "CHECKOUT", "A1", 60000));
  screen.loop();
  assert(cyd.count(df::SHOW_CHALLENGE) == 1 && cyd.frames.back().size() == 8 + 2 + 1 + 1 + 2 + 1 + 218 + 2);
  // A longer token (here 56 characters) would make a 231-character URI: refused, nothing written.
  std::string longer = std::string(uri) + "0123456789abc";
  assert(longer.size() == 231 && !screen.showChallenge(longer.c_str(), "CHECKOUT", "A1", 60000));
  assert(screen.drawState() == Display::DrawState::Failed);
  assert(!screen.showChallenge(uri, "LEND", "A1", 60000));      // unknown action
  assert(!screen.showChallenge(uri, "CHECKOUT", "A1", 60001));  // ttl over 60 s
}

void displayAvailabilityFollowsTheStatus() {
  FakePlatform p;
  FakeCyd cyd(&p.now);
  I2cDisplay screen(cyd, p, 0x42);
  assert(!screen.available());  // nothing heard yet
  p.now += 10;
  screen.loop();  // PING
  assert(!screen.available() && cyd.count(df::PING) == 1);
  p.now += 10;
  screen.loop();  // status
  assert(screen.available());
  const uint32_t heard = p.now;
  cyd.silent = true;
  while (p.now < heard + 2990) {
    p.now += 10;
    screen.loop();
  }
  assert(screen.available());
  p.now += 10;
  assert(!screen.available());  // 3 s without a valid status

  for (int mode = 0; mode < 2; mode++) {  // an unpowered slave, a corrupted status: never available
    FakePlatform q;
    FakeCyd node(&q.now);
    (mode == 0 ? node.readsFF : node.corruptStatus) = true;
    I2cDisplay other(node, q, 0x42);
    for (int i = 0; i < 300; i++) {
      q.now += 10;
      other.loop();
    }
    assert(!other.available());
  }
}

void challengeIsDisplayedOnlyOnceTheNodeShowsOurSeq() {
  I2cRig r;
  r.cyd.drawDelayMs = 200;
  assert(r.deliver(r.challenge(M1, 41)).empty());  // submitted, not proven
  r.run(150);
  assert(r.answers().empty() && r.cyd.count(df::SHOW_CHALLENGE) == 1);
  df::Command sent = r.cyd.last(df::SHOW_CHALLENGE);
  assert(sent.ttlMs == 60000 && sent.action == df::CHECKOUT && strcmp(sent.code, "A1") == 0);
  assert(std::string(sent.text) == std::string("aegis://local-access?v=1&challengeId=") + CHALLENGE +
                                       "&operationId=" + OP + "&lockerId=" + LOCKER + "&token=" + FAKE_TOKEN);
  r.run(100);
  std::vector<Message> out = r.answers();
  assert(out.size() == 1 && field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED" &&
         field(out[0], "displayMessageId") == M1 && field(out[0], "challengeId") == CHALLENGE);

  I2cRig stale;  // a SHOWN about another seq never counts
  stale.cyd.staleSeq = true;
  stale.deliver(stale.challenge(M1, 41));
  stale.run(990);
  assert(stale.answers().empty());
  int clears = stale.cyd.count(df::CLEAR);
  stale.run(50);
  out = stale.answers();
  assert(out.size() == 1 && field(out[0], "type") == "DISPLAY_REJECTED" &&
         field(out[0], "reason") == "SCREEN_UNAVAILABLE" && field(out[0], "challengeId") == CHALLENGE);
  stale.run(30);
  assert(stale.cyd.count(df::CLEAR) == clears + 1 && stale.logged("display draw timed out cmd=1"));

  I2cRig failed;  // the node reports FAILED for our seq
  failed.cyd.drawFails = true;
  failed.deliver(failed.challenge(M1, 41));
  failed.run(100);
  out = failed.answers();
  assert(out.size() == 1 && field(out[0], "reason") == "SCREEN_UNAVAILABLE");
  assert(failed.cyd.state == df::IDLE && failed.logged("display draw failed cmd=1"));  // CLEAR sent

  I2cRig status;  // a status is submitted the same way and never acknowledged
  status.transport.inbound.push_back(statusMessage(status.platform.unix, status.hub.deviceSessionId(), M1, 41, "CONFIRMED"));
  status.run(200);
  df::Command shown = status.cyd.last(df::SHOW_STATUS);
  assert(status.answers().empty() && shown.ttlMs == 30000 && strcmp(shown.text, "CONFIRMED") == 0);
}

void redeliveryWhilePendingGivesOneFrameAndOneAnswer() {
  I2cRig r;
  r.cyd.drawDelayMs = 300;
  Message m = r.challenge(M1, 41);
  assert(r.deliver(m).empty());
  r.run(100);
  assert(r.deliver(m).empty());  // still drawing: nothing yet, no new frame
  r.transport.published.clear();
  r.run(300);
  std::vector<Message> out = r.answers();
  assert(out.size() == 1 && field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED");
  out = r.deliver(m);  // after resolution: the known answer again
  assert(out.size() == 1 && field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED");
  r.run(100);
  assert(r.cyd.count(df::SHOW_CHALLENGE) == 1 && r.cyd.draws == 1);
}

void supersededPendingChallengeIsScreenUnavailable() {
  I2cRig r;
  r.cyd.drawDelayMs = 500;
  Message first = r.challenge(M1, 41);
  r.deliver(first);
  r.run(50);
  std::vector<Message> out = r.deliver(r.challenge(M2, 42));
  assert(out.size() == 1 && field(out[0], "displayMessageId") == M1 &&
         field(out[0], "reason") == "SCREEN_UNAVAILABLE");
  r.transport.published.clear();
  r.run(600);
  out = r.answers();
  assert(out.size() == 1 && field(out[0], "displayMessageId") == M2 &&
         field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED");
  out = r.deliver(first);
  assert(out.size() == 1 && field(out[0], "reason") == "SCREEN_UNAVAILABLE");
}

void writeRetriesAndCorruptedFrameResend() {
  I2cRig r;
  r.cyd.nackWrites = 2;
  r.deliver(r.challenge(M1, 41));
  r.run(200);
  std::vector<Message> out = r.answers();
  assert(out.size() == 1 && field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED");
  assert(r.logged("display write failed cmd=1"));

  I2cRig nack;
  nack.cyd.nackWrites = 3;
  nack.deliver(nack.challenge(M1, 41));
  nack.run(100);
  out = nack.answers();
  assert(out.size() == 1 && field(out[0], "reason") == "SCREEN_UNAVAILABLE");
  assert(nack.cyd.count(df::SHOW_CHALLENGE) == 0 && nack.cyd.count(df::CLEAR) >= 2);  // boot CLEAR, then this one

  I2cRig crc;
  crc.cyd.badCrcShows = 1;
  crc.deliver(crc.challenge(M1, 41));
  crc.run(200);
  out = crc.answers();
  assert(out.size() == 1 && field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED");
  std::vector<uint32_t> seqs;
  for (const auto& f : crc.cyd.frames) {
    if (f[2] == df::SHOW_CHALLENGE) seqs.push_back(df::getU32(&f[3]));
  }
  assert(seqs.size() == 2 && seqs[0] == seqs[1]);  // the same frame, resent once

  I2cRig twice;
  twice.cyd.badCrcShows = 2;  // one resend only
  twice.deliver(twice.challenge(M1, 41));
  twice.run(200);
  out = twice.answers();
  assert(out.size() == 1 && field(out[0], "reason") == "SCREEN_UNAVAILABLE" && twice.cyd.count(df::SHOW_CHALLENGE) == 2);
}

void busResetAfterFiveFailuresIsRateLimited() {
  FakePlatform p;
  FakeCyd cyd(&p.now);
  cyd.silent = true;
  I2cDisplay screen(cyd, p, 0x42);
  for (int i = 0; i < 2000; i++) {  // 20 s
    p.now += 10;
    const int before = cyd.transactions;
    screen.loop();
    assert(cyd.transactions - before <= 1);
  }
  assert(cyd.resets.size() >= 2 && cyd.resets.size() <= 4);
  for (size_t i = 1; i < cyd.resets.size(); i++) assert(cyd.resets[i] - cyd.resets[i - 1] >= 5000);
}

void deadlineAndConnectionLossSendClear() {
  I2cRig r;
  r.deliver(r.challenge(M1, 41, 45));
  r.run(100);
  assert(r.answers().size() == 1 && r.cyd.last(df::SHOW_CHALLENGE).ttlMs == 45000);
  int clears = r.cyd.count(df::CLEAR);
  r.platform.unix += 44;
  r.run(30);
  assert(r.cyd.count(df::CLEAR) == clears);
  r.platform.unix += 1;
  r.run(30);
  assert(r.cyd.count(df::CLEAR) == clears + 1 && r.cyd.state == df::IDLE);

  I2cRig lost;
  lost.deliver(lost.challenge(M1, 41));
  lost.run(100);
  clears = lost.cyd.count(df::CLEAR);
  lost.transport.events.push_back(Transport::Event::Disconnected);
  lost.run(30);
  assert(lost.cyd.count(df::CLEAR) == clears + 1);

  I2cRig offline;  // the draw resolves while offline: nothing published, the answer waits for a redelivery
  offline.cyd.drawDelayMs = 500;
  Message m = offline.challenge(M1, 41);
  offline.deliver(m);
  offline.run(50);
  offline.transport.events.push_back(Transport::Event::Disconnected);
  offline.run(1200);
  assert(offline.answers().empty());
  offline.transport.events.push_back(Transport::Event::Connected);
  offline.run(20);
  std::vector<Message> out = offline.deliver(m);
  assert(out.size() == 1 && field(out[0], "reason") == "SCREEN_UNAVAILABLE");
}

void nodeRestartIsLogged() {
  I2cRig r;
  r.cyd.bootId++;
  r.run(1100);
  assert(r.logged("display node restarted"));
}

void compartmentCodeMustFitTheFrame() {
  DisplayRig r;
  auto withCode = [&](const char* messageId, uint64_t revision, const char* code) {
    Message m = r.challenge(messageId, revision);
    std::string payload = m.payload;
    const std::string from = "\"compartmentCode\":\"A1\"";
    payload.replace(payload.find(from), from.size(), std::string("\"compartmentCode\":\"") + code + "\"");
    snprintf(m.payload, sizeof(m.payload), "%s", payload.c_str());
    return r.deliver(m);
  };
  std::vector<Message> out = withCode(M1, 41, "A12345678");  // 9 characters
  assert(out.size() == 1 && field(out[0], "type") == "DISPLAY_REJECTED" &&
         field(out[0], "reason") == "INVALID_DISPLAY_PAYLOAD" && field(out[0], "displayMessageId") == M1);
  out = withCode(M2, 42, "A\xC3\xA9");  // not ASCII
  assert(out.size() == 1 && field(out[0], "reason") == "INVALID_DISPLAY_PAYLOAD");
  out = withCode(M3, 43, std::string(100, 'A').c_str());
  assert(out.size() == 1 && field(out[0], "reason") == "INVALID_DISPLAY_PAYLOAD");
  out = withCode("fd6c4a94-4ac4-4a91-9249-59347c3b6487", 44, "A1234567");  // 8 characters fit
  assert(out.size() == 1 && field(out[0], "type") == "ACCESS_CHALLENGE_DISPLAYED");
  assert(r.screen.draws == 1);
}

void tokenLeavesNoTraceInTheDriver() {
  I2cRig r;
  r.cyd.drawDelayMs = 100;
  r.deliver(r.challenge(M1, 41));
  r.step();
  assert(holds(&r.screen, sizeof(r.screen), FAKE_TOKEN));  // the scan does see a held token
  r.run(200);
  assert(r.answers().size() == 1);
  assert(!holds(&r.screen, sizeof(r.screen), FAKE_TOKEN) && !holds(&r.inbox, sizeof(r.inbox), FAKE_TOKEN));

  I2cRig failed;
  failed.cyd.drawFails = true;
  failed.deliver(failed.challenge(M1, 41));
  failed.run(100);
  assert(!holds(&failed.screen, sizeof(failed.screen), FAKE_TOKEN) &&
         !holds(&failed.inbox, sizeof(failed.inbox), FAKE_TOKEN));
  for (const I2cRig* rig : {&r, &failed}) {
    for (const Message& m : rig->transport.published) assert(strstr(m.payload, FAKE_TOKEN) == nullptr);
    for (const std::string& line : rig->platform.logs) {
      assert(line.find(FAKE_TOKEN) == std::string::npos && line.find("aegis://") == std::string::npos);
    }
  }
}

// Prints every payload on its own line so run.sh can check that it is strict JSON.
void dumpPayloads(const char* path) {
  Rig r;
  r.platform.now = 100000;
  r.connectOnce();
  r.hub.publishScan(1, sampleScan(r.platform));
  ScanResult empty = sampleScan(r.platform);
  empty.tagCount = 0;
  empty.reader = 'F';
  r.hub.publishScan(1, empty);
  FILE* f = fopen(path, "w");
  assert(f != nullptr);
  fprintf(f, "%s\n", r.transport.wills[0].payload);
  for (const Message& m : r.transport.published) fprintf(f, "%s\n", m.payload);
  DisplayRig d;
  d.deliver(d.challenge(M1, 41));
  for (const Message& m : d.transport.published) fprintf(f, "%s\n", m.payload);
  d.deliver(d.challenge(M2, 41));
  for (const Message& m : d.transport.published) fprintf(f, "%s\n", m.payload);
  d.deliver(d.status(M3, 42));
  d.deliver(d.status(M3, 42));
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
  subscribesToCommandsOnEveryConnection();
  refusedSubscriptionDropsTheConnection();
  commandIsActedOnceAndAnswered();
  refusalsAreAnsweredAndRemembered();
  failedActuationIsRejectedAndConsumes();
  unsafeJournalOrMissingHandlerNeverActuates();
  journalSurvivesAReboot();
  commandInterruptedByRebootIsUncertainAndNeverRepeated();
  invalidInboundIsReportedWithinTheRateLimit();
  parseInstantRules();
  cellFrameFormat();
  lineReaderDropsOversizedLines();
  cellIsUnknownThenConnected();
  cellIsDisconnectedAfterThreeMissesAndRecovers();
  cellOnTheWrongPortIsDisconnected();
  staleEchoedAndCorruptedFramesNeverCount();
  replyHeldByABusyLoopStillCounts();
  pingsArePacedAndNeverOverlap();
  portsAreIndependent();
  cellReportsItsLatchAndReader();
  silentOrForeignCellStateIsNeverReported();
  heartbeatReportsEachCell();
  heartbeatWithoutSourceIsUnknown();
  firstScanStartsOnceConnectedAndFetchesEveryTag();
  emptyAndFaultedWindowsAreReportedToo();
  nextScanAfterThirtySecondsOrWhenTheLatchCloses();
  scanIsAbandonedWhenTheLinkDrops();
  tagFromAnotherCellOrIndexNeverCounts();
  scanIsPublishedAsRfidScanCompleted();
  fullScanFitsTheMessage();
  displayIsSubscribedOnEveryConnection();
  challengeIsAcknowledgedOnlyAfterItIsDrawn();
  deadlineIsKeptLocallyAndNeverExtended();
  duplicateReplaysItsAnswerWithoutRedrawing();
  staleRevisionNeverReplacesTheScreen();
  invalidInstructionsAreRefusedAndKeepTheScreen();
  statusReplacesTheQrWithoutAcknowledgement();
  lostConnectionAndRebootClearTheQr();
  unreadableDisplayMessagesAreReportedInvalid();
  displayFrameFormat();
  challengeUriFitsTheFrame();
  displayAvailabilityFollowsTheStatus();
  challengeIsDisplayedOnlyOnceTheNodeShowsOurSeq();
  redeliveryWhilePendingGivesOneFrameAndOneAnswer();
  supersededPendingChallengeIsScreenUnavailable();
  writeRetriesAndCorruptedFrameResend();
  busResetAfterFiveFailuresIsRateLimited();
  deadlineAndConnectionLossSendClear();
  nodeRestartIsLogged();
  compartmentCodeMustFitTheFrame();
  tokenLeavesNoTraceInTheDriver();
  if (argc > 1) dumpPayloads(argv[1]);
  puts("all host tests passed");
  return 0;
}
