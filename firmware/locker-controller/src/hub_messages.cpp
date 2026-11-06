#include "hub_messages.h"

#include <cstdarg>
#include <cstdio>
#include <ctime>

#include "contract.h"

namespace aegis {

namespace {

struct Writer {
  char* buf;
  size_t cap;
  size_t len = 0;
  bool ok = true;

  void add(const char* fmt, ...) __attribute__((format(printf, 2, 3))) {
    if (!ok) return;
    va_list args;
    va_start(args, fmt);
    int n = vsnprintf(buf + len, cap - len, fmt, args);
    va_end(args);
    if (n < 0 || static_cast<size_t>(n) >= cap - len) {
      ok = false;
    } else {
      len += static_cast<size_t>(n);
    }
  }
};

bool start(Message* out, Writer* w, const Envelope& env, const char* type, const char* channel, int qos,
           bool retain) {
  int n = snprintf(out->topic, sizeof(out->topic), "aegis/v1/lockers/%s/%s", env.lockerId, channel);
  if (n < 0 || static_cast<size_t>(n) >= sizeof(out->topic)) return false;
  out->qos = qos;
  out->retain = retain;
  w->buf = out->payload;
  w->cap = sizeof(out->payload);
  w->add("{\"schemaVersion\":\"%s\",\"messageId\":\"%s\",\"type\":\"%s\",\"lockerId\":\"%s\","
         "\"timestamp\":\"%s\",\"deviceSessionId\":\"%s\",\"bootCount\":%lu,\"sequence\":%lu",
         SCHEMA_VERSION, env.messageId, type, env.lockerId, env.timestamp, env.deviceSessionId,
         static_cast<unsigned long>(env.bootCount), static_cast<unsigned long>(env.sequence));
  return w->ok;
}

}  // namespace

void formatInstant(int64_t unixSeconds, char out[INSTANT_LEN]) {
  time_t t = static_cast<time_t>(unixSeconds);
  struct tm tm;
  gmtime_r(&t, &tm);
  snprintf(out, INSTANT_LEN, "%04d-%02d-%02dT%02d:%02d:%02dZ", (tm.tm_year + 1900) % 10000, tm.tm_mon + 1,
           tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec);
}

bool buildAvailability(Message* out, const Envelope& env, const char* connectionId, bool online,
                       const char* offlineReason) {
  Writer w;
  if (!start(out, &w, env, "DEVICE_AVAILABILITY", "status", 1, true)) return false;
  w.add(",\"connectionId\":\"%s\",\"status\":\"%s\",\"reason\":\"%s\"}", connectionId,
        online ? "ONLINE" : "OFFLINE", online ? "CONNECTED" : offlineReason);
  return w.ok;
}

bool buildDeviceRestarted(Message* out, const Envelope& env, const char* resetReason, const char* firmwareVersion) {
  Writer w;
  if (!start(out, &w, env, "DEVICE_RESTARTED", "events", 1, false)) return false;
  w.add(",\"resetReason\":\"%s\",\"firmwareVersion\":\"%s\"}", resetReason, firmwareVersion);
  return w.ok;
}

bool buildCommandAck(Message* out, const Envelope& env, const char* commandMessageId, const char* operationId,
                     const char* compartmentId, const char* result) {
  Writer w;
  if (!start(out, &w, env, "COMMAND_ACKNOWLEDGED", "events", 1, false)) return false;
  w.add(",\"commandMessageId\":\"%s\",\"operationId\":\"%s\",\"compartmentId\":\"%s\",\"result\":\"%s\"}",
        commandMessageId, operationId, compartmentId, result);
  return w.ok;
}

bool buildCommandRejected(Message* out, const Envelope& env, const char* commandMessageId, const char* operationId,
                          const char* compartmentId, const char* reason, const char* detail) {
  Writer w;
  if (!start(out, &w, env, "COMMAND_REJECTED", "events", 1, false)) return false;
  w.add(",\"commandMessageId\":\"%s\",\"operationId\":\"%s\",\"compartmentId\":\"%s\",\"reason\":\"%s\","
        "\"detail\":\"%s\"}",
        commandMessageId, operationId, compartmentId, reason, detail);
  return w.ok;
}

bool buildInboundInvalid(Message* out, const Envelope& env, const char* compartmentId, const char* detail) {
  Writer w;
  if (!start(out, &w, env, "DEVICE_ERROR", "events", 1, false)) return false;
  if (compartmentId != nullptr) w.add(",\"compartmentId\":\"%s\"", compartmentId);
  w.add(",\"errorCode\":\"INBOUND_MESSAGE_INVALID\",\"severity\":\"WARNING\",\"detail\":\"%s\"}", detail);
  return w.ok;
}

bool buildHeartbeat(Message* out, const Envelope& env, const HeartbeatFacts& facts) {
  Writer w;
  if (!start(out, &w, env, "HEARTBEAT", "status", 0, false)) return false;
  w.add(",\"connectionId\":\"%s\",\"firmwareVersion\":\"%s\",\"uptimeSeconds\":%lu,\"clockSynchronized\":%s,"
        "\"network\":{\"rssiDbm\":%d},\"compartments\":[",
        facts.connectionId, facts.firmwareVersion, static_cast<unsigned long>(facts.uptimeSeconds),
        facts.clockSynchronized ? "true" : "false", facts.rssiDbm);
  for (size_t i = 0; i < facts.compartmentCount; i++) {
    const CompartmentFacts& c = facts.compartments[i];
    w.add("%s{\"compartmentId\":\"%s\",\"cellAddress\":%d,\"connectionStatus\":\"%s\",\"readerStatus\":\"%s\","
          "\"doorState\":\"%s\",\"lockState\":\"%s\"}",
          i == 0 ? "" : ",", c.compartmentId, c.cellAddress, c.connectionStatus, c.readerStatus, c.doorState,
          c.lockState);
  }
  w.add("]}");
  return w.ok;
}

}  // namespace aegis
