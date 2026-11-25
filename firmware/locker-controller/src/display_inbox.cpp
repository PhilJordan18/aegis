#include "display_inbox.h"

#include <cstdio>
#include <cstring>

#include "command_inbox.h"  // parseInstant

namespace aegis {

namespace {

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

// One field of a display message. `nested` names the `payload` object's fields.
struct Field {
  const char* key;
  bool nested;
  char* out;   // string value; "null" leaves it empty with isNull set
  size_t cap;
  uint64_t* number;  // integer value instead of a string
  bool found = false;
  bool isNull = false;
};

struct Parser {
  const char* p;
  Field* fields;
  size_t n;

  void ws() {
    while (isSpace(*p)) p++;
  }

  // A string without escapes: no field of a display message needs one.
  bool readString(const char** start, size_t* len) {
    if (*p != '"') return false;
    *start = ++p;
    while (*p != '\0' && *p != '"' && *p != '\\') p++;
    if (*p != '"') return false;
    *len = static_cast<size_t>(p - *start);
    p++;
    return true;
  }

  Field* find(const char* key, size_t len, bool nested) {
    for (size_t i = 0; i < n; i++) {
      if (fields[i].nested == nested && strlen(fields[i].key) == len && memcmp(fields[i].key, key, len) == 0) {
        return &fields[i];
      }
    }
    return nullptr;
  }

  bool value(Field* f, bool nested) {
    if (*p == '"') {
      const char* v;
      size_t len;
      if (!readString(&v, &len)) return false;
      if (f == nullptr) return true;
      if (f->found || f->out == nullptr) return false;
      // Too long for its field: read as empty, so the field check refuses it (an over-long
      // compartmentCode is INVALID_DISPLAY_PAYLOAD, not an unreadable message).
      if (len >= f->cap) len = 0;
      memcpy(f->out, v, len);
      f->out[len] = '\0';
      f->found = true;
      return true;
    }
    if (*p == '{') {
      // Only `payload` may be an object, and only at the top level.
      if (nested || f == nullptr || f->out != nullptr || f->number != nullptr || f->found) return false;
      f->found = true;
      return object(true);
    }
    if (*p == '[') return false;
    const char* start = p;
    while (*p != '\0' && *p != ',' && *p != '}' && !isSpace(*p)) p++;
    size_t len = static_cast<size_t>(p - start);
    if (len == 0) return false;
    if (f == nullptr) return true;
    if (f->found) return false;
    if (len == 4 && memcmp(start, "null", 4) == 0 && f->out != nullptr) {
      f->out[0] = '\0';
      f->found = f->isNull = true;
      return true;
    }
    if (f->number == nullptr || len > 15) return false;
    uint64_t v = 0;
    for (size_t i = 0; i < len; i++) {
      if (start[i] < '0' || start[i] > '9') return false;
      v = v * 10 + static_cast<uint64_t>(start[i] - '0');
    }
    *f->number = v;
    f->found = true;
    return true;
  }

  bool object(bool nested) {
    ws();
    if (*p++ != '{') return false;
    ws();
    if (*p == '}') {
      p++;
      return true;
    }
    for (;;) {
      ws();
      const char* key;
      size_t keyLen;
      if (!readString(&key, &keyLen)) return false;
      ws();
      if (*p++ != ':') return false;
      ws();
      if (!value(find(key, keyLen, nested), nested)) return false;
      ws();
      if (*p == ',') {
        p++;
        continue;
      }
      return *p++ == '}';
    }
  }
};

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

// base64url without padding of 32 bytes: 43 characters.
bool isToken(const char* s) {
  if (strlen(s) != 43) return false;
  for (const char* c = s; *c; c++) {
    if (!((*c >= 'A' && *c <= 'Z') || (*c >= 'a' && *c <= 'z') || (*c >= '0' && *c <= '9') || *c == '-' ||
          *c == '_')) {
      return false;
    }
  }
  return true;
}

// A short code made of the given characters only.
bool isCode(const char* s, bool digitsAllowed) {
  if (*s == '\0') return false;
  for (const char* c = s; *c; c++) {
    if (!((*c >= 'A' && *c <= 'Z') || *c == '_' || (digitsAllowed && *c >= '0' && *c <= '9'))) return false;
  }
  return true;
}

}  // namespace

const char* displayReasonName(DisplayReason r) {
  switch (r) {
    case DisplayReason::ScreenUnavailable: return "SCREEN_UNAVAILABLE";
    case DisplayReason::TargetSessionMismatch: return "TARGET_SESSION_MISMATCH";
    case DisplayReason::DisplayExpired: return "DISPLAY_EXPIRED";
    case DisplayReason::StaleDisplayRevision: return "STALE_DISPLAY_REVISION";
    default: return "INVALID_DISPLAY_PAYLOAD";
  }
}

bool challengeUri(const DisplayInstruction& in, const char* lockerId, char* out, size_t cap) {
  int n = snprintf(out, cap, "aegis://local-access?v=1&challengeId=%s&operationId=%s&lockerId=%s&token=%s",
                   in.challengeId, in.operationId, lockerId, in.token);
  return n > 0 && static_cast<size_t>(n) < cap;
}

void DisplayInbox::begin() {
  display_.clear();
  showing_ = false;
}

const DisplayResult* DisplayInbox::known(const char* messageId) const {
  for (const Known& k : known_) {
    if (k.messageId[0] != '\0' && strcmp(k.messageId, messageId) == 0) return &k.result;
  }
  return nullptr;
}

DisplayResult DisplayInbox::remember(const DisplayResult& r) {
  Known& k = known_[next_];
  next_ = (next_ + 1) % MEMORY;
  memcpy(k.messageId, r.instruction.messageId, UUID_LEN);
  k.result = r;
  memset(k.result.instruction.token, 0, sizeof(k.result.instruction.token));
  return k.result;
}

DisplayReason DisplayInbox::check(const DisplayInstruction& in, const char* sessionId, int64_t now, bool clock) {
  if (strcmp(in.targetSession, sessionId) != 0) return DisplayReason::TargetSessionMismatch;
  if (!clock || !display_.available()) return DisplayReason::ScreenUnavailable;
  // The hub never extends a window: the backend's deadline, capped from the issue time (§27.1, §27.3).
  int64_t deadline = in.issuedAt + (in.challenge ? CHALLENGE_MAX_S : STATUS_MAX_S);
  if (in.expiresAt < deadline) deadline = in.expiresAt;
  if (now >= deadline) return DisplayReason::DisplayExpired;
  if (anyAccepted_ && in.revision <= maxRevision_) return DisplayReason::StaleDisplayRevision;
  return DisplayReason::None;
}

DisplayResult DisplayInbox::accept(const Message& message, const char* sessionId, int64_t nowUnix,
                                   bool clockSynchronized) {
  DisplayResult r;
  if (message.retain) {
    r.kind = DisplayInbound::Retained;
    return r;
  }

  DisplayInstruction& in = r.instruction;
  char schema[8], type[32], lockerId[UUID_LEN], issued[24], expires[24], reasonCode[48];
  uint64_t revision = 0;
  Field fields[] = {
      {"schemaVersion", false, schema, sizeof(schema), nullptr},
      {"messageId", false, in.messageId, sizeof(in.messageId), nullptr},
      {"type", false, type, sizeof(type), nullptr},
      {"lockerId", false, lockerId, sizeof(lockerId), nullptr},
      {"compartmentId", false, in.compartmentId, sizeof(in.compartmentId), nullptr},
      {"operationId", false, in.operationId, sizeof(in.operationId), nullptr},
      {"targetDeviceSessionId", false, in.targetSession, sizeof(in.targetSession), nullptr},
      {"displayRevision", false, nullptr, 0, &revision},
      {"issuedAt", false, issued, sizeof(issued), nullptr},
      {"expiresAt", false, expires, sizeof(expires), nullptr},
      {"payload", false, nullptr, 0, nullptr},
      {"challengeId", true, in.challengeId, sizeof(in.challengeId), nullptr},
      {"action", true, in.action, sizeof(in.action), nullptr},
      {"compartmentCode", true, in.compartmentCode, sizeof(in.compartmentCode), nullptr},
      {"token", true, in.token, sizeof(in.token), nullptr},
      {"status", true, in.status, sizeof(in.status), nullptr},
      {"reasonCode", true, reasonCode, sizeof(reasonCode), nullptr},
  };
  enum { SCHEMA, MESSAGE, TYPE, LOCKER, COMPARTMENT, OPERATION, TARGET, REVISION, ISSUED, EXPIRES, PAYLOAD,
         CHALLENGE, ACTION, CODE, TOKEN, STATUS, REASON_CODE };
  Parser parser{message.payload, fields, sizeof(fields) / sizeof(fields[0])};
  bool readable = parser.object(false);
  parser.ws();
  readable = readable && *parser.p == '\0';

  // Correlation needs the instruction's ids and revision (§27.2); without them nothing can answer it.
  if (!readable || !fields[MESSAGE].found || !isUuid(in.messageId) || !fields[OPERATION].found ||
      !isUuid(in.operationId) || !fields[COMPARTMENT].found || !isUuid(in.compartmentId) ||
      !fields[REVISION].found) {
    memset(in.token, 0, sizeof(in.token));
    return r;
  }
  in.revision = revision;
  for (size_t i = 0; i < config_.compartmentCount; i++) {
    if (strcmp(config_.compartments[i].compartmentId, in.compartmentId) == 0) r.compartmentKnown = true;
  }

  // A redelivery gets its known answer before any check, and is never drawn again (§27.2, §27.4).
  if (const DisplayResult* k = known(in.messageId)) return *k;

  const bool challenge = fields[TYPE].found && strcmp(type, "DISPLAY_ACCESS_CHALLENGE") == 0;
  const bool status = fields[TYPE].found && strcmp(type, "DISPLAY_OPERATION_STATUS") == 0;
  in.challenge = challenge;
  bool valid = (challenge || status) && fields[SCHEMA].found && strncmp(schema, "3.", 2) == 0 &&
               fields[LOCKER].found && strcmp(lockerId, config_.lockerId) == 0 && r.compartmentKnown &&
               fields[TARGET].found && isUuid(in.targetSession) && fields[ISSUED].found &&
               parseInstant(issued, &in.issuedAt) && fields[EXPIRES].found && parseInstant(expires, &in.expiresAt) &&
               in.expiresAt > in.issuedAt && fields[PAYLOAD].found && fields[ACTION].found &&
               (strcmp(in.action, "CHECKOUT") == 0 || strcmp(in.action, "RETURN") == 0) && fields[CODE].found &&
               isCode(in.compartmentCode, true);
  if (challenge) {
    valid = valid && fields[CHALLENGE].found && isUuid(in.challengeId) && fields[TOKEN].found && isToken(in.token) &&
            !fields[STATUS].found;
  } else {
    // A status carries no challenge: its rejection is correlated without challengeId (§27.2).
    in.challengeId[0] = '\0';
    valid = valid && fields[STATUS].found && isCode(in.status, false) && fields[REASON_CODE].found &&
            !fields[TOKEN].found;
  }
  if (challenge && !(fields[CHALLENGE].found && isUuid(in.challengeId))) in.challengeId[0] = '\0';

  r.kind = DisplayInbound::Rejected;
  r.reason = valid ? check(in, sessionId, nowUnix, clockSynchronized) : DisplayReason::InvalidDisplayPayload;
  if (r.reason != DisplayReason::None) {
    memset(in.token, 0, sizeof(in.token));
    return remember(r);  // a refused instruction never touches what is on screen (§27.4)
  }

  int64_t deadline = in.issuedAt + (challenge ? CHALLENGE_MAX_S : STATUS_MAX_S);
  if (in.expiresAt < deadline) deadline = in.expiresAt;
  // Remaining time, rounded down and at most 60 s; check() guarantees at least 1 s.
  const uint16_t ttlMs = static_cast<uint16_t>((deadline - nowUnix > CHALLENGE_MAX_S ? CHALLENGE_MAX_S
                                                                                      : deadline - nowUnix) * 1000);
  // This instruction replaces the screen: one still waiting for its draw never will (it is not acknowledged).
  if (pending_) {
    pending_ = false;
    supersededResult_ = unavailable(pendingResult_);
    superseded_ = true;
  }
  bool submitted;
  if (challenge) {
    char uri[256];
    submitted = challengeUri(in, config_.lockerId, uri, sizeof(uri)) &&
                display_.showChallenge(uri, in.action, in.compartmentCode, ttlMs);
    memset(uri, 0, sizeof(uri));
  } else {
    submitted = display_.showStatus(in.action, in.compartmentCode, in.status, ttlMs);
  }
  memset(in.token, 0, sizeof(in.token));
  if (!submitted) {
    display_.clear();  // never leave a half-drawn screen
    showing_ = false;
    r.reason = DisplayReason::ScreenUnavailable;
    return remember(r);
  }
  anyAccepted_ = true;
  maxRevision_ = in.revision;
  showing_ = true;
  showingChallenge_ = challenge;
  deadline_ = deadline;
  r.reason = DisplayReason::None;
  r.kind = challenge ? DisplayInbound::Displayed : DisplayInbound::Shown;
  if (display_.drawState() != Display::DrawState::Drawn) {
    pendingResult_ = r;
    pending_ = true;
    r.kind = DisplayInbound::Pending;
  }
  return remember(r);
}

DisplayResult DisplayInbox::unavailable(DisplayResult r) {
  r.kind = DisplayInbound::Rejected;
  r.reason = DisplayReason::ScreenUnavailable;
  update(r);
  return r;
}

void DisplayInbox::update(const DisplayResult& r) {
  for (Known& k : known_) {
    if (k.messageId[0] != '\0' && strcmp(k.messageId, r.instruction.messageId) == 0) k.result = r;
  }
}

bool DisplayInbox::poll(DisplayResult* out) {
  if (superseded_) {
    superseded_ = false;
    *out = supersededResult_;
    return true;
  }
  if (!pending_) return false;
  const Display::DrawState s = display_.drawState();
  if (s == Display::DrawState::Drawing) return false;
  pending_ = false;
  if (s == Display::DrawState::Drawn) {
    update(pendingResult_);
    *out = pendingResult_;
    return true;
  }
  display_.clear();  // a failed or timed-out draw leaves no half-drawn screen
  showing_ = false;
  *out = unavailable(pendingResult_);
  return true;
}

void DisplayInbox::loop(int64_t nowUnix) {
  if (showing_ && nowUnix >= deadline_) {
    display_.clear();
    showing_ = false;
  }
}

void DisplayInbox::connectionLost() {
  if (showing_ && showingChallenge_) {
    display_.clear();
    showing_ = false;
  }
}

}  // namespace aegis
