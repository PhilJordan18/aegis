#pragma once

#include <cstddef>
#include <cstdint>

namespace aegis {

constexpr size_t UUID_LEN = 37;     // 36 characters and the terminator
constexpr size_t INSTANT_LEN = 21;  // "2026-09-16T14:31:10Z" and the terminator

struct Message {
  char topic[96];
  char payload[1536];  // worst-case heartbeat with MAX_COMPARTMENTS cells is about 1.3 KB
  int qos;
  bool retain;
};

// The MQTT connection. Hardware stays behind this interface so the connection logic
// runs on a host without a board.
class Transport {
 public:
  enum class Event { None, Connected, Disconnected };

  virtual ~Transport() = default;
  // Starts a connection that registers `will`; the result arrives through pollEvent().
  // Any previous connection is dropped first, so no Will or session client is reused.
  virtual void connect(const Message& will) = 0;
  // False when the message could not be handed to the client.
  virtual bool publish(const Message& message) = 0;
  // Asks the broker for `topic`; false when the client refused it.
  virtual bool subscribe(const char* topic, int qos) = 0;
  // Next received message, false when none is waiting. `retain` is the flag of the received message.
  virtual bool pollMessage(Message* out) = 0;
  // Drops the connection without a DISCONNECT, so the broker publishes the Will.
  virtual void abort() = 0;
  virtual Event pollEvent() = 0;
};

class Platform {
 public:
  virtual ~Platform() = default;
  virtual uint32_t nowMs() = 0;  // monotonic, wraps at 2^32
  virtual int64_t unixSeconds() = 0;
  virtual bool clockSynchronized() = 0;
  virtual bool networkUp() = 0;
  virtual int rssiDbm() = 0;
  virtual void newUuid(char out[UUID_LEN]) = 0;  // lowercase, canonical
  virtual uint32_t random(uint32_t bound) = 0;   // 0 .. bound - 1
  // Persists the incremented boot counter before returning it (doc 10 §8.1).
  virtual bool incrementBootCount(uint32_t* bootCount) = 0;
  virtual const char* resetReason() = 0;  // controlled value of doc 10 §13.1
  // Durable slots of the command journal (doc 10 §16.1), one record per slot so a write wears
  // one flash entry only. Read returns false for a missing record or one of another size.
  virtual bool journalRead(size_t slot, void* buf, size_t len) = 0;
  virtual bool journalWrite(size_t slot, const void* buf, size_t len) = 0;
  virtual void log(const char*) {}
};

}  // namespace aegis
