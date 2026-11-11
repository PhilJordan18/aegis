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

// Sequence of the last PING the hub wrote on `port`, consuming what it wrote.
uint32_t lastPing(FakePort& port) {
  size_t end = port.tx.rfind('\n');
  assert(end != std::string::npos);
  size_t start = port.tx.rfind('\n', end - 1);
  std::string line = port.tx.substr(start == std::string::npos ? 0 : start + 1, end - (start == std::string::npos ? 0 : start + 1));
  port.tx.clear();
  std::vector<char> buf(line.begin(), line.end());
  buf.push_back('\0');
  uint32_t seq;
  assert(cellframe::unseal(buf.data()) && cellframe::parsePing(buf.data(), &seq));
  return seq;
}

std::string replyFrame(uint32_t seq, uint8_t address, uint32_t bootId = 0xB0071D01, uint8_t reset = 1) {
  char frame[cellframe::MAX_LINE];
  size_t n = cellframe::encodeReply(cellframe::Reply{seq, address, bootId, reset}, frame, sizeof(frame));
  assert(n > 0);
  return std::string(frame, n);
}

struct CellRig {
  FakePlatform platform;
  FakePort port;
  CellLink link{1, port, platform};

  // One full poll: the hub pings, the cell answers 6 ms later (or stays silent), the reply window
  // closes, and the clock reaches the next poll.
  void poll(bool answers, uint8_t address = 1) {
    link.loop();
    uint32_t seq = lastPing(port);
    platform.now += 6;
    if (answers) port.receive(replyFrame(seq, address));
    link.loop();
    platform.now += CELL_REPLY_TIMEOUT_MS - 6;
    link.loop();
    assert(port.tx.empty());  // no second PING inside one poll period
    platform.now += CELL_POLL_INTERVAL_MS - CELL_REPLY_TIMEOUT_MS;
  }
  void answer(uint8_t address = 1) { poll(true, address); }
  void silence() { poll(false); }
};

void cellFrameFormat() {
  assert(cellframe::crc16("123456789", 9) == 0x29B1);  // CRC-16/CCITT-FALSE check value
  char frame[cellframe::MAX_LINE];
  size_t n = cellframe::encodePing(0x1A, frame, sizeof(frame));
  assert(n == 16 && strncmp(frame, "P,0000001A,", 11) == 0 && frame[15] == '\n');

  std::string reply = replyFrame(0xDEADBEEF, 2, 0x01020304, 0x0F);
  assert(reply.size() == 31 && reply.compare(0, 26, "R,DEADBEEF,02,01020304,0F,") == 0);
  std::vector<char> buf(reply.begin(), reply.end() - 1);
  buf.push_back('\0');
  assert(cellframe::unseal(buf.data()));
  cellframe::Reply r;
  assert(cellframe::parseReply(buf.data(), &r));
  assert(r.seq == 0xDEADBEEF && r.cellAddress == 2 && r.bootId == 0x01020304 && r.resetCode == 0x0F);

  char corrupted[] = "R,DEADBEEF,02,01020304,0E,0000";
  assert(!cellframe::unseal(corrupted));
  char lower[] = "R,deadbeef,02,01020304,0F";
  assert(!cellframe::parseReply(lower, &r));
  char shortPing[] = "P,1A";
  uint32_t seq;
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

const char* fakeCellStatus(int cellAddress) { return cellAddress == 1 ? "CONNECTED" : "DISCONNECTED"; }

void heartbeatReportsEachCellLink() {
  Rig r;
  r.hub.cellStatus(fakeCellStatus);
  r.connectOnce();
  const Message& heartbeat = r.transport.published.back();
  assert(has(heartbeat, "\"type\":\"HEARTBEAT\""));
  assert(has(heartbeat, "\"cellAddress\":1,\"connectionStatus\":\"CONNECTED\",\"readerStatus\":\"UNKNOWN\","
                        "\"doorState\":\"UNKNOWN\",\"lockState\":\"UNKNOWN\""));
  assert(has(heartbeat, "\"cellAddress\":2,\"connectionStatus\":\"DISCONNECTED\""));
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
  heartbeatReportsEachCellLink();
  if (argc > 1) dumpPayloads(argv[1]);
  puts("all host tests passed");
  return 0;
}
