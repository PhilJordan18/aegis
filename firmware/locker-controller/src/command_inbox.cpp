#include "command_inbox.h"

#include <cstring>

namespace aegis {

namespace {

struct Slot {
  const char* key;
  char* out;
  size_t cap;
  bool found;
};

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

// Reads a string without escapes (no field of a command needs one) and leaves `p` after it.
bool readString(const char*& p, const char** start, size_t* len) {
  if (*p != '"') return false;
  *start = ++p;
  while (*p != '\0' && *p != '"' && *p != '\\') p++;
  if (*p != '"') return false;
  *len = static_cast<size_t>(p - *start);
  p++;
  return true;
}

// Flat JSON object only: strings, and scalars that are skipped. A known key must hold a
// string that fits, once; nested values are refused.
bool parseObject(const char* p, Slot* slots, size_t n) {
  auto ws = [&p] { while (isSpace(*p)) p++; };
  ws();
  if (*p++ != '{') return false;
  ws();
  if (*p == '}') return false;  // an empty object lacks every required field anyway
  for (;;) {
    ws();
    const char* key;
    size_t keyLen;
    if (!readString(p, &key, &keyLen)) return false;
    ws();
    if (*p++ != ':') return false;
    ws();
    Slot* slot = nullptr;
    for (size_t i = 0; i < n; i++) {
      if (strlen(slots[i].key) == keyLen && memcmp(slots[i].key, key, keyLen) == 0) slot = &slots[i];
    }
    if (*p == '"') {
      const char* value;
      size_t valueLen;
      if (!readString(p, &value, &valueLen)) return false;
      if (slot != nullptr) {
        if (slot->found || valueLen >= slot->cap) return false;
        memcpy(slot->out, value, valueLen);
        slot->out[valueLen] = '\0';
        slot->found = true;
      }
    } else {
      if (slot != nullptr || *p == '{' || *p == '[') return false;
      const char* start = p;
      while (*p != '\0' && *p != ',' && *p != '}' && !isSpace(*p)) p++;
      if (p == start) return false;
    }
    ws();
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p++ != '}') return false;
    ws();
    return *p == '\0';
  }
}

// Lowercase only: an uppercase twin of a messageId must not slip past the duplicate check.
bool isUuid(const char* s) {
  if (strlen(s) != 36) return false;
  for (size_t i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (s[i] != '-') return false;
    } else if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) {
      return false;
    }
  }
  return true;
}

bool digits(const char* s, size_t n, int* out) {
  int v = 0;
  for (size_t i = 0; i < n; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    v = v * 10 + (s[i] - '0');
  }
  *out = v;
  return true;
}

}  // namespace

bool parseInstant(const char* t, int64_t* unixSeconds) {
  if (strlen(t) != 20 || t[4] != '-' || t[7] != '-' || t[10] != 'T' || t[13] != ':' || t[16] != ':' || t[19] != 'Z') {
    return false;
  }
  int y, mo, d, h, mi, s;
  if (!digits(t, 4, &y) || !digits(t + 5, 2, &mo) || !digits(t + 8, 2, &d) || !digits(t + 11, 2, &h) ||
      !digits(t + 14, 2, &mi) || !digits(t + 17, 2, &s)) {
    return false;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return false;
  // Days since 1970-01-01 (Howard Hinnant's civil-from-days, inverted).
  y -= mo <= 2;
  const int era = y / 400;
  const int yoe = y - era * 400;
  const int doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  const int64_t days = static_cast<int64_t>(era) * 146097 + doe - 719468;
  *unixSeconds = days * 86400 + h * 3600 + mi * 60 + s;
  return true;
}

const char* reasonName(Reason r) {
  switch (r) {
    case Reason::InvalidPayload: return "INVALID_PAYLOAD";
    case Reason::UnsupportedSchema: return "UNSUPPORTED_SCHEMA";
    case Reason::WrongLocker: return "WRONG_LOCKER";
    case Reason::UnknownCompartment: return "UNKNOWN_COMPARTMENT";
    case Reason::ClockNotSynchronized: return "CLOCK_NOT_SYNCHRONIZED";
    case Reason::CommandExpired: return "COMMAND_EXPIRED";
    case Reason::LockActuationFailed: return "LOCK_ACTUATION_FAILED";
    case Reason::PreviousExecutionUncertain: return "PREVIOUS_EXECUTION_UNCERTAIN";
    default: return "INTERNAL_DEVICE_ERROR";
  }
}

const char* reasonDetail(Reason r) {
  switch (r) {
    case Reason::InvalidPayload: return "The command payload is invalid or inconsistent.";
    case Reason::UnsupportedSchema: return "The schema major version is not supported by this hub.";
    case Reason::WrongLocker: return "The command targets another locker.";
    case Reason::UnknownCompartment: return "The compartment is not known to this hub.";
    case Reason::ClockNotSynchronized: return "The hub clock is not synchronized yet.";
    case Reason::CommandExpired: return "The command expired before it reached the hub.";
    case Reason::LockActuationFailed: return "The lock actuation failed.";
    case Reason::PreviousExecutionUncertain: return "The hub restarted during execution; the outcome is unknown.";
    default: return "The hub could not process the command.";
  }
}

namespace {

constexpr int64_t RETENTION_SECONDS = 24 * 3600;  // §16.1

// Reached an actuation attempt: the operation is consumed (§9.1 step 8).
bool actuated(const JournalEntry& e) {
  return e.state == CommandState::Executing || e.state == CommandState::Acknowledged ||
         e.reason == Reason::LockActuationFailed || e.reason == Reason::PreviousExecutionUncertain;
}

// Entries whose loss could allow a second actuation, or that cannot be forgotten yet (§16.1).
bool protectedEntry(const JournalEntry& e, int64_t now) {
  if (e.state == CommandState::Executing) return true;
  if (actuated(e)) return now - e.at < RETENTION_SECONDS;
  const bool fixed = e.reason == Reason::InvalidPayload || e.reason == Reason::UnsupportedSchema ||
                     e.reason == Reason::WrongLocker || e.reason == Reason::UnknownCompartment ||
                     e.reason == Reason::CommandExpired;
  return !fixed && e.expiresAt > now;
}

void copyId(char* to, const char* from) {
  strncpy(to, from, UUID_LEN - 1);
  to[UUID_LEN - 1] = '\0';
}

}  // namespace

int CommandInbox::find(const char* messageId) const {
  for (size_t i = 0; i < CAPACITY; i++) {
    if (entries_[i].state != CommandState::Free && strcmp(entries_[i].messageId, messageId) == 0) return static_cast<int>(i);
  }
  return -1;
}

int CommandInbox::findOperation(const char* operationId) const {
  for (size_t i = 0; i < CAPACITY; i++) {
    if (entries_[i].state != CommandState::Free && actuated(entries_[i]) &&
        strcmp(entries_[i].operationId, operationId) == 0) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

// A free slot, else the oldest entry that is not protected, else none (§16.1).
int CommandInbox::slotFor(int64_t now) const {
  int victim = -1;
  for (size_t i = 0; i < CAPACITY; i++) {
    if (entries_[i].state == CommandState::Free) return static_cast<int>(i);
    if (protectedEntry(entries_[i], now)) continue;
    if (victim < 0 || entries_[i].seq < entries_[victim].seq) victim = static_cast<int>(i);
  }
  return victim;
}

bool CommandInbox::store(size_t slot) {
  entries_[slot].seq = ++seq_;
  return platform_.journalWrite(slot, &entries_[slot], sizeof(JournalEntry));
}

void CommandInbox::load() {
  for (size_t i = 0; i < CAPACITY; i++) {
    JournalEntry e;
    // A missing or differently sized record (older layout) reads as free; never as a command.
    if (!platform_.journalRead(i, &e, sizeof(e)) || e.state == CommandState::Free) continue;
    entries_[i] = e;
    if (e.seq > seq_) seq_ = e.seq;
  }
  for (size_t i = 0; i < CAPACITY; i++) {
    if (entries_[i].state != CommandState::Executing) continue;
    entries_[i].state = CommandState::Rejected;  // never re-actuated, §9.1
    entries_[i].reason = Reason::PreviousExecutionUncertain;
    store(i);
    unreported_[i] = true;
  }
}

void CommandInbox::record(const Command& c, CommandState state, Reason reason, int64_t now) {
  int slot = slotFor(now);
  if (slot < 0) return;  // nothing may be forgotten: the answer is still sent, just not remembered
  JournalEntry& e = entries_[slot];
  e = JournalEntry{};
  copyId(e.messageId, c.messageId);
  copyId(e.operationId, c.operationId);
  copyId(e.compartmentId, c.compartmentId);
  e.state = state;
  e.reason = reason;
  e.expiresAt = c.expiresAt;
  e.at = now;
  if (!store(slot)) platform_.log("journal write failed");
}

bool CommandInbox::begin(const Command& command, int64_t now) {
  int slot = slotFor(now);
  if (slot < 0) return false;
  JournalEntry& e = entries_[slot];
  e = JournalEntry{};
  copyId(e.messageId, command.messageId);
  copyId(e.operationId, command.operationId);
  copyId(e.compartmentId, command.compartmentId);
  e.state = CommandState::Executing;
  e.expiresAt = command.expiresAt;
  e.at = now;
  if (store(slot)) return true;
  e.state = CommandState::Free;  // not persisted: acting now could repeat after a reboot
  return false;
}

void CommandInbox::finish(const Command& command, bool ok) {
  int slot = find(command.messageId);
  if (slot < 0) return;
  entries_[slot].state = ok ? CommandState::Acknowledged : CommandState::Rejected;
  entries_[slot].reason = ok ? Reason::None : Reason::LockActuationFailed;
  if (!store(slot)) platform_.log("journal write failed");
}

const JournalEntry* CommandInbox::nextUncertain() const {
  for (size_t i = 0; i < CAPACITY; i++) {
    if (unreported_[i]) return &entries_[i];
  }
  return nullptr;
}

void CommandInbox::markReported(const JournalEntry& entry) { unreported_[&entry - entries_] = false; }

InboundResult CommandInbox::accept(const Message& message, int64_t now, bool clockSynchronized) {
  InboundResult r;
  char schema[8], type[32], lockerId[UUID_LEN], issuedAt[INSTANT_LEN], expiresAt[INSTANT_LEN];
  Command& c = r.command;
  Slot slots[] = {{"schemaVersion", schema, sizeof(schema), false}, {"type", type, sizeof(type), false},
                  {"messageId", c.messageId, UUID_LEN, false}, {"operationId", c.operationId, UUID_LEN, false},
                  {"lockerId", lockerId, sizeof(lockerId), false}, {"compartmentId", c.compartmentId, UUID_LEN, false},
                  {"issuedAt", issuedAt, sizeof(issuedAt), false}, {"expiresAt", expiresAt, sizeof(expiresAt), false}};
  enum { SCHEMA, TYPE, MESSAGE_ID, OPERATION_ID, LOCKER_ID, COMPARTMENT_ID, ISSUED_AT, EXPIRES_AT };

  const bool parsed = parseObject(message.payload, slots, sizeof(slots) / sizeof(slots[0]));
  if (parsed && slots[COMPARTMENT_ID].found && isUuid(c.compartmentId)) {
    for (size_t i = 0; i < config_.compartmentCount; i++) {
      r.compartmentKnown = r.compartmentKnown || strcmp(config_.compartments[i].compartmentId, c.compartmentId) == 0;
    }
  }
  if (message.retain) {  // §7.2 comes first, even for a command that is valid otherwise
    r.kind = Inbound::Retained;
    return r;
  }
  if (!parsed || !slots[MESSAGE_ID].found || !slots[OPERATION_ID].found || !slots[COMPARTMENT_ID].found ||
      !isUuid(c.messageId) || !isUuid(c.operationId) || !isUuid(c.compartmentId)) {
    r.kind = Inbound::Uncorrelable;
    return r;
  }

  // Deduplication comes before the other guards, even after expiresAt (§9.1).
  int dup = find(c.messageId);
  if (dup < 0 && (dup = findOperation(c.operationId)) >= 0) r.viaOperation = true;
  if (dup >= 0) {
    r.kind = Inbound::Duplicate;
    r.known = entries_[dup];
    return r;
  }

  r.kind = Inbound::Rejected;
  int64_t issued = 0;
  if (!slots[SCHEMA].found) r.reason = Reason::InvalidPayload;
  else if (schema[0] != '3' || (schema[1] != '\0' && schema[1] != '.')) r.reason = Reason::UnsupportedSchema;
  else if (!slots[TYPE].found || !slots[LOCKER_ID].found || !slots[ISSUED_AT].found || !slots[EXPIRES_AT].found ||
           strcmp(type, "UNLOCK_COMPARTMENT") != 0 || !isUuid(lockerId) || !parseInstant(issuedAt, &issued) ||
           !parseInstant(expiresAt, &c.expiresAt)) r.reason = Reason::InvalidPayload;
  else if (strcmp(lockerId, config_.lockerId) != 0) r.reason = Reason::WrongLocker;
  else if (!r.compartmentKnown) r.reason = Reason::UnknownCompartment;
  else if (!clockSynchronized) r.reason = Reason::ClockNotSynchronized;
  else if (now >= c.expiresAt) r.reason = Reason::CommandExpired;
  else r.kind = Inbound::Accepted;

  if (r.kind == Inbound::Rejected) record(c, CommandState::Rejected, r.reason, now);
  return r;
}

}  // namespace aegis
