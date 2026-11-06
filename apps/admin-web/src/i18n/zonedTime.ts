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

/**
 * `2026-12-01T00:00` in `America/Toronto` → `2026-12-01T05:00:00Z`. A wall time skipped by a daylight-saving
 * change resolves to the instant just after the gap; a repeated one to its first occurrence. Null when unreadable.
 */
export function zonedInputToInstant(value: string, zone: string): string | null {
  const match = INPUT.exec(value)
  if (match === null) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number, number, number]
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  if (new Date(asUtc).getUTCDate() !== day) return null
  const first = asUtc - offsetAt(asUtc, zone)
  const candidates = [first, asUtc - offsetAt(first, zone)]
  // A candidate is exact when the zone's clock reads the input there; a skipped wall time has none.
  const exact = candidates.filter((epochMs) => utcOf(wallClock(epochMs, zone)) === asUtc).sort((a, b) => a - b)
  const epochMs = exact[0] ?? Math.max(...candidates)
  return new Date(epochMs).toISOString().replace('.000Z', 'Z')
}
