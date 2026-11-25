#pragma once

#include <cstddef>
#include <cstdint>

#include "hub_config.h"
#include "platform.h"

namespace aegis {

// The hub's screen (doc 10 §27): the CYD display node on I2C (I2cDisplay), or a fake in tests.
class Display {
 public:
  // Outcome of the latest show*(): Drawn only once the screen proved the draw.
  enum class DrawState { Idle, Drawing, Drawn, Failed };

  virtual ~Display() = default;
  virtual bool available() = 0;
  // Submits the QR of `uri` with the action and compartment code, shown for at most `ttlMs`; false
  // when it cannot even be submitted. drawState() then tells when it is really on screen.
  // `uri` carries the token: an implementation never logs it and wipes its copy once handled.
  virtual bool showChallenge(const char* uri, const char* action, const char* compartmentCode, uint16_t ttlMs) = 0;
  // Submits the predefined message for a backend status (§27.3).
  virtual bool showStatus(const char* action, const char* compartmentCode, const char* status, uint16_t ttlMs) = 0;
  // Back to the idle screen; wipes any QR. A show still drawing ends Failed.
  virtual void clear() = 0;
  virtual DrawState drawState() = 0;
};

// Reasons of DISPLAY_REJECTED (§27.2).
enum class DisplayReason : uint8_t {
  None,
  ScreenUnavailable,
  TargetSessionMismatch,
  DisplayExpired,
  StaleDisplayRevision,
  InvalidDisplayPayload,
};
const char* displayReasonName(DisplayReason reason);

struct DisplayInstruction {
  bool challenge;  // DISPLAY_ACCESS_CHALLENGE, else DISPLAY_OPERATION_STATUS
  char messageId[UUID_LEN];
  char operationId[UUID_LEN];
  char compartmentId[UUID_LEN];
  char targetSession[UUID_LEN];
  uint64_t revision;
  int64_t issuedAt;   // unix seconds
  int64_t expiresAt;  // unix seconds
  char challengeId[UUID_LEN];  // challenge only
  char action[9];              // CHECKOUT or RETURN
  char compartmentCode[9];
  char token[44];              // challenge only: base64url of 32 bytes, 43 characters
  char status[25];             // status only
};

enum class DisplayInbound {
  Ignored,       // not for the screen at all
  Retained,      // §7.2: report INBOUND_MESSAGE_INVALID
  Uncorrelable,  // unreadable, or no messageId/operationId/compartmentId/revision: INBOUND_MESSAGE_INVALID
  Pending,       // submitted, not yet proven on screen: nothing to publish until poll() resolves it
  Displayed,     // publish ACCESS_CHALLENGE_DISPLAYED
  Shown,         // a status is on screen: no positive acknowledgement (§27.3)
  Rejected,      // publish DISPLAY_REJECTED with `reason`
};

// What the hub answers for one display message. `instruction` holds its correlation (never the
// token once handled); `challengeCorrelated` says whether the rejection carries challengeId.
struct DisplayResult {
  DisplayInbound kind = DisplayInbound::Uncorrelable;
  DisplayReason reason = DisplayReason::None;
  DisplayInstruction instruction = {};
  bool compartmentKnown = false;
};

// Doc 10 §27: checks each `display` message, draws or refuses it, keeps the deadline locally and
// remembers the answer of recent messages so a redelivery gets the same answer without a redraw.
// Everything lives in RAM: a reboot clears the screen and starts a new session (§27.4).
class DisplayInbox {
 public:
  static constexpr size_t MEMORY = 16;
  static constexpr int64_t CHALLENGE_MAX_S = 60;  // §27.1
  static constexpr int64_t STATUS_MAX_S = 30;     // §27.3

  DisplayInbox(const HubConfig& config, Display& display) : config_(config), display_(display) {}

  // Clears the screen; call at boot.
  void begin();
  DisplayResult accept(const Message& message, const char* sessionId, int64_t nowUnix, bool clockSynchronized);
  // Ends the shown QR or status at its local deadline.
  void loop(int64_t nowUnix);
  // True with the final answer of an instruction that was Pending: Displayed or Shown once drawn,
  // Rejected SCREEN_UNAVAILABLE if the draw failed, timed out or a newer instruction replaced it.
  // Call until false; the known answer of that messageId is updated too.
  bool poll(DisplayResult* out);
  // Connection lost: the backend invalidates a pending challenge (§27.4), so the QR goes too.
  void connectionLost();
  bool showing() const { return showing_; }

 private:
  struct Known {
    char messageId[UUID_LEN];
    DisplayResult result;
  };
  const DisplayResult* known(const char* messageId) const;
  DisplayResult remember(const DisplayResult& r);
  void update(const DisplayResult& r);
  DisplayResult unavailable(DisplayResult r);
  DisplayReason check(const DisplayInstruction& in, const char* sessionId, int64_t nowUnix, bool clock);

  const HubConfig& config_;
  Display& display_;
  Known known_[MEMORY] = {};
  size_t next_ = 0;
  bool anyAccepted_ = false;
  uint64_t maxRevision_ = 0;
  bool showing_ = false;
  bool showingChallenge_ = false;
  int64_t deadline_ = 0;
  bool pending_ = false;
  DisplayResult pendingResult_ = {};
  bool superseded_ = false;
  DisplayResult supersededResult_ = {};
};

// The QR content of §27.1. False when it does not fit.
bool challengeUri(const DisplayInstruction& in, const char* lockerId, char* out, size_t cap);

}  // namespace aegis
