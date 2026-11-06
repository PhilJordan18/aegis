/**
 * The user search `q` (09 §22.3, ADR-014), anticipated before sending; the API stays the authority. Only the outer
 * Unicode spaces are removed, the length is counted in extended grapheme clusters, nothing is ever truncated, and
 * no case, accent or normalization form is changed.
 */

export const SEARCH_MAX_GRAPHEMES = 100

/**
 * The 19 code points of general category Z (Zs, Zl, Zp), listed rather than taken from `\p{Z}` so that the set does
 * not follow the browser's Unicode version. Controls (tab, line feed, U+0085) are not spaces; U+200B, U+200D, U+FE0F
 * and U+FEFF stay in the text.
 */
const SPACES = new Set([0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000])

/** U+0000–U+001F, U+007F–U+009F and lone surrogates (09 §23.2). */
// eslint-disable-next-line no-control-regex
const REFUSED = /[\u0000-\u001F\u007F-\u009F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

export type SearchText =
  /** No filter: the client omits `q`. */
  | { readonly kind: 'empty' }
  | { readonly kind: 'valid'; readonly q: string; readonly graphemes: number }
  | { readonly kind: 'size'; readonly graphemes: number }
  | { readonly kind: 'invalid' }

/** Removes the outer spaces one code point at a time; every Z space is in the BMP, so one code unit is one code point. */
export function trimSearchSpaces(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && SPACES.has(text.charCodeAt(start))) start++
  while (end > start && SPACES.has(text.charCodeAt(end - 1))) end--
  return text.slice(start, end)
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Extended grapheme clusters (UAX #29) in the JavaScript engine's Unicode version. */
export function countGraphemes(text: string): number {
  return Array.from(segmenter.segment(text)).length
}

/**
 * A search box's text as the API will judge it, in the API's order: size first, then refused characters. An empty
 * text after trimming means no filter, never an explicit empty `q`.
 */
export function readSearchText(raw: string): SearchText {
  const q = trimSearchSpaces(raw)
  if (q === '') return { kind: 'empty' }
  const graphemes = countGraphemes(q)
  if (graphemes > SEARCH_MAX_GRAPHEMES) return { kind: 'size', graphemes }
  if (REFUSED.test(q)) return { kind: 'invalid' }
  return { kind: 'valid', q, graphemes }
}
