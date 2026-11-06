/**
 * Wall-clock time in a named IANA zone, for `<input type="datetime-local">`. The browser zone is never used:
 * a business instant is entered and shown in the zone stated next to it. `Intl` alone, no library.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

interface WallClock {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

function wallClock(epochMs: number, zone: string): WallClock {
  const parts: Record<string, number> = {}
  for (const part of formatterFor(zone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return { year: parts.year ?? 0, month: parts.month ?? 1, day: parts.day ?? 1, hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: parts.second ?? 0 }
}

function utcOf({ year, month, day, hour, minute, second }: WallClock): number {
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

/** Offset of `zone` from UTC at `epochMs`, in milliseconds (positive east of Greenwich). */
function offsetAt(epochMs: number, zone: string): number {
  const whole = Math.floor(epochMs / 1000) * 1000
  return utcOf(wallClock(whole, zone)) - whole
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** `2026-12-01T05:00:00Z` in `America/Toronto` → `2026-12-01T00:00`. Null for an unreadable instant. */
export function instantToZonedInput(instant: string, zone: string): string | null {
  const epochMs = Date.parse(instant)
  if (Number.isNaN(epochMs)) return null
  const clock = wallClock(epochMs, zone)
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`
}

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const DAY_MS = 86_400_000

/**
 * A wall time read in a zone. Nothing is shifted silently (Philippe, 6 November 2026): a time skipped by the spring
 * change is `nonexistent`, and a time repeated by the autumn change is `ambiguous` until the person picks one of its
 * two instants.
 */
export type ZonedInput =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'nonexistent' }
  | { readonly kind: 'exact'; readonly instant: string }
  | { readonly kind: 'ambiguous'; readonly earlier: string; readonly later: string }

const isoOf = (epochMs: number) => new Date(epochMs).toISOString().replace('.000Z', 'Z')

/** `2026-12-01T00:00` in `America/Toronto` → exact `2026-12-01T05:00:00Z`. */
export function resolveZonedInput(value: string, zone: string): ZonedInput {
  const match = INPUT.exec(value)
  if (match === null) return { kind: 'invalid' }
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number, number, number]
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return { kind: 'invalid' }
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  if (new Date(asUtc).getUTCDate() !== day) return { kind: 'invalid' }
  // The offsets a day before and a day after cover both sides of any change near this wall time.
  const candidates = [...new Set([asUtc - offsetAt(asUtc - DAY_MS, zone), asUtc - offsetAt(asUtc + DAY_MS, zone)])]
  const exact = candidates.filter((epochMs) => utcOf(wallClock(epochMs, zone)) === asUtc).sort((a, b) => a - b)
  const [earlier, later] = exact
  if (earlier === undefined) return { kind: 'nonexistent' }
  if (later === undefined) return { kind: 'exact', instant: isoOf(earlier) }
  return { kind: 'ambiguous', earlier: isoOf(earlier), later: isoOf(later) }
}

/** `UTC−04:00`: the zone's offset at an instant, which tells the two occurrences of a repeated hour apart. */
export function utcOffsetLabel(instant: string, zone: string): string {
  const epochMs = Date.parse(instant)
  if (Number.isNaN(epochMs)) return ''
  const minutes = Math.round(offsetAt(epochMs, zone) / 60_000)
  const sign = minutes < 0 ? '\u2212' : '+'
  const abs = Math.abs(minutes)
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
