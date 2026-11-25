// Host tests of the cell's local observations (src/cell_state.h). Run by
// firmware/locker-controller/tests/host/run.sh.

#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>

#include "../../src/cell_state.h"

using namespace aegis;
using namespace aegis::cell;

namespace {

bool feed(UhfFrameReader& reader, const std::vector<uint8_t>& bytes) {
  bool complete = false;
  for (uint8_t b : bytes) complete = reader.push(b) || complete;
  return complete;
}

const std::vector<uint8_t> kNoTag = {0xBB, 0x01, 0xFF, 0x00, 0x01, 0x15, 0x16, 0x7E};
// Tag notification captured on the bench (#19): RSSI CB, PC 3400, EPC E2004717CCC06422C2B80112.
const std::vector<uint8_t> kTag = {0xBB, 0x02, 0x22, 0x00, 0x11, 0xCB, 0x34, 0x00, 0xE2, 0x00, 0x47, 0x17, 0xCC,
                                   0xC0, 0x64, 0x22, 0xC2, 0xB8, 0x01, 0x12, 0x00, 0x00, 0x00, 0x7E};

std::vector<uint8_t> withChecksum(std::vector<uint8_t> f) {
  uint8_t sum = 0;
  for (size_t i = 1; i < f.size() - 2; i++) sum = static_cast<uint8_t>(sum + f[i]);
  f[f.size() - 2] = sum;
  return f;
}

void uhfFramesAreRecognised() {
  UhfFrameReader r;
  assert(feed(r, kNoTag));
  assert(feed(r, withChecksum(kTag)));
  // Noise before a frame, a bad checksum, a bad end byte and an oversized length are all dropped.
  assert(feed(r, {0x00, 0x7E, 0x11}) == false);
  std::vector<uint8_t> badSum = kNoTag;
  badSum[6] ^= 1;
  assert(!feed(r, badSum));
  std::vector<uint8_t> badEnd = kNoTag;
  badEnd[7] = 0x7F;
  assert(!feed(r, badEnd));
  assert(!feed(r, {0xBB, 0x02, 0x22, 0x01, 0x00}));
  assert(feed(r, kNoTag));  // and the reader resynchronises afterwards
}

void readerIsUnknownThenHealthyThenFaulted() {
  ReaderHealth h;
  assert(h.status() == cellframe::STATE_UNKNOWN);
  assert(h.pollDue(0));
  assert(!h.pollDue(READER_POLL_MS - 1));
  h.onValidFrame();
  assert(h.status() == cellframe::READER_HEALTHY);
  uint32_t now = 0;
  for (uint32_t i = 0; i < READER_FAULT_AFTER - 1; i++) {
    now += READER_POLL_MS;
    assert(h.pollDue(now));
  }
  assert(h.status() == cellframe::READER_HEALTHY);  // one unanswered poll short of a fault
  now += READER_POLL_MS;
  assert(h.pollDue(now));
  assert(h.status() == cellframe::READER_FAULTED);
  h.onValidFrame();
  assert(h.status() == cellframe::READER_HEALTHY);
}

void readerSilentFromBootIsFaulted() {
  ReaderHealth h;
  for (uint32_t i = 0; i < READER_FAULT_AFTER; i++) assert(h.pollDue(i * READER_POLL_MS));
  assert(h.status() == cellframe::READER_FAULTED);
}

void latchIsDebounced() {
  LatchSwitch s;
  assert(s.state() == cellframe::STATE_UNKNOWN);
  s.begin(false);  // contact open: striker held
  assert(s.state() == cellframe::LOCK_LOCKED);
  s.sample(true, 100);
  s.sample(true, 100 + LATCH_DEBOUNCE_MS - 1);
  assert(s.state() == cellframe::LOCK_LOCKED);
  s.sample(true, 100 + LATCH_DEBOUNCE_MS);
  assert(s.state() == cellframe::LOCK_UNLOCKED);
  // A bounce shorter than the debounce never flips the state.
  s.sample(false, 200);
  s.sample(true, 210);
  s.sample(true, 300);
  assert(s.state() == cellframe::LOCK_UNLOCKED);
}

void replyCarriesCellState() {
  LatchSwitch s;
  s.begin(false);
  ReaderHealth h;
  h.pollDue(0);
  h.onValidFrame();
  char frame[cellframe::MAX_LINE];
  size_t n = cellframe::encodeReply(cellframe::Reply{7, 1, 0xB0071D01, 1, s.state(), h.status()}, frame, sizeof(frame));
  assert(n == 39);
  frame[n - 1] = '\0';
  cellframe::Reply r;
  assert(cellframe::unseal(frame) && cellframe::parseReply(frame, &r));
  assert(r.lock == 'L' && r.reader == 'H');
}

void tagEpcIsExtracted() {
  UhfFrameReader r;
  assert(feed(r, withChecksum(kTag)));
  const uint8_t* epc;
  size_t len;
  assert(tagEpc(r, &epc, &len) && len == 12 && epc[0] == 0xE2 && epc[11] == 0x12);
  assert(feed(r, kNoTag));
  assert(!tagEpc(r, &epc, &len));  // "no tag" carries no EPC
}

// Runs a window with the reader answering `answers` of its polls, each answer holding `tag` if set.
ScanWindow runWindow(uint32_t answers, const std::vector<uint8_t>* tag = nullptr) {
  ScanWindow w;
  w.start(1000);
  uint32_t polls = 0;
  for (uint32_t now = 1000; now <= 1000 + SCAN_WINDOW_MS; now += 10) {
    if (w.pollDue(now)) {
      if (polls++ < answers) {
        w.onValidFrame();
        if (tag != nullptr) w.onTag(tag->data(), tag->size());
      }
    }
  }
  assert(polls == SCAN_WINDOW_MS / SCAN_POLL_MS);
  return w;
}

void windowCountsReadsAndJudgesTheReader() {
  const std::vector<uint8_t> epc = {0xE2, 0x00, 0x47, 0x17, 0xCC, 0xC0, 0x64, 0x22, 0xC2, 0xB8, 0x01, 0x12};
  ScanWindow w = runWindow(30, &epc);
  assert(w.state() == cellframe::SCAN_DONE && w.reader() == cellframe::READER_HEALTHY && w.tagCount() == 1);
  assert(strcmp(w.tag(0)->epc, "E2004717CCC06422C2B80112") == 0 && w.tag(0)->readCount == 30);
  assert(w.tag(1) == nullptr);

  assert(runWindow(30).reader() == cellframe::READER_HEALTHY);  // healthy and empty: a proof of absence
  assert(runWindow(SCAN_MIN_ANSWERED).reader() == cellframe::READER_HEALTHY);
  assert(runWindow(SCAN_MIN_ANSWERED - 1).reader() == cellframe::STATE_UNKNOWN);
  assert(runWindow(0).reader() == cellframe::READER_FAULTED);
}

void windowStatesAndOverflow() {
  ScanWindow w;
  assert(w.state() == cellframe::SCAN_NONE && w.reader() == cellframe::NO_WINDOW && w.tagCount() == 0);
  w.start(0);
  assert(w.state() == cellframe::SCAN_RUNNING && w.reader() == cellframe::NO_WINDOW);
  for (uint8_t i = 0; i <= cellframe::MAX_SCAN_TAGS; i++) {
    uint8_t epc[2] = {0xAA, i};
    w.onTag(epc, 2);
  }
  assert(w.tagCount() == 0);  // nothing is handed out before the window ends
  w.pollDue(SCAN_WINDOW_MS);
  assert(w.state() == cellframe::SCAN_DONE && w.tagCount() == cellframe::MAX_SCAN_TAGS);
  assert(w.reader() == cellframe::STATE_UNKNOWN);  // a ninth tag was left out: proves nothing
  uint8_t late[2] = {0xBB, 0};
  w.onTag(late, 2);  // after the window: ignored
  assert(w.tagCount() == cellframe::MAX_SCAN_TAGS);
}

}  // namespace

int main() {
  tagEpcIsExtracted();
  windowCountsReadsAndJudgesTheReader();
  windowStatesAndOverflow();
  uhfFramesAreRecognised();
  readerIsUnknownThenHealthyThenFaulted();
  readerSilentFromBootIsFaulted();
  latchIsDebounced();
  replyCarriesCellState();
  puts("all cell host tests passed");
  return 0;
}
