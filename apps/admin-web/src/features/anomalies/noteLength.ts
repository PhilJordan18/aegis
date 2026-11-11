/**
 * Grapheme count of a note, for the indicative counter only (ADR-014 counts graphemes for search text; the
 * note's unit is undecided, G9). The server judges the length: this number never blocks a submission.
 */
export function countGraphemes(text: string, locale: string): number {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text).length
  return [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)].length
}

/** The one client-side rule (09 §18.2): a note that is empty or only whitespace is not a note. */
export function isBlank(text: string): boolean {
  return text.trim() === ''
}

/** The documented maximum, shown by the counter; enforcement stays with the server. */
export const NOTE_MAX = 500
