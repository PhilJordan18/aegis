#pragma once
#include <stdint.h>

// One anti-aliased glyph: an 8-bit coverage bitmap plus its placement relative to the baseline.
struct AAGlyph {
  uint16_t cp;     // Unicode code point
  uint32_t off;    // offset of the bitmap in the font's bit table
  uint8_t w, h;    // bitmap size
  int8_t x0, y0;   // bitmap origin relative to the pen and the baseline
  uint16_t adv;    // advance in 1/256 px
};
struct AAFont {
  const AAGlyph* glyphs;
  const uint8_t* bits;
  uint16_t n;
};

enum ScreenResult { RES_OK, RES_EXPIRED, RES_FAILED, RES_ANOMALY, RES_OTHER };
