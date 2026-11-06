import { describe, expect, it } from 'vitest'
import { instantToZonedInput, zonedInputToInstant } from './zonedTime'

const ZONE = 'America/Toronto'

describe('zoned wall-clock input', () => {
  it('shows an instant in the named zone, never the browser one', () => {
    expect(instantToZonedInput('2026-12-01T05:00:00Z', ZONE)).toBe('2026-12-01T00:00')
    expect(instantToZonedInput('2026-07-01T16:30:00.123456Z', ZONE)).toBe('2026-07-01T12:30')
    expect(instantToZonedInput('not an instant', ZONE)).toBeNull()
  })

  it('reads a wall time back as a UTC instant, in and out of daylight saving time', () => {
    expect(zonedInputToInstant('2026-12-01T00:00', ZONE)).toBe('2026-12-01T05:00:00Z')
    expect(zonedInputToInstant('2026-07-01T12:30', ZONE)).toBe('2026-07-01T16:30:00Z')
  })

  it('round-trips', () => {
    for (const instant of ['2026-03-08T06:59:00Z', '2026-03-08T07:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2027-01-31T23:59:00Z']) {
      const input = instantToZonedInput(instant, ZONE)
      expect(input).not.toBeNull()
      const back = zonedInputToInstant(input ?? '', ZONE)
      // The autumn overlap repeats 01:30: the first occurrence is chosen, which is the earlier instant.
      expect(back === instant || (input === '2026-11-01T01:30' && back === '2026-11-01T05:30:00Z')).toBe(true)
    }
  })

  it('moves a wall time skipped by the spring change after the gap', () => {
    // 2026-03-08 02:30 does not exist in Toronto: clocks go from 02:00 EST to 03:00 EDT (07:00Z).
    expect(zonedInputToInstant('2026-03-08T02:30', ZONE)).toBe('2026-03-08T07:30:00Z')
  })

  it('refuses unreadable values', () => {
    for (const value of ['', '2026-02-30T10:00', '2026-13-01T10:00', '2026-12-01 10:00', '2026-12-01T24:00']) {
      expect(zonedInputToInstant(value, ZONE)).toBeNull()
    }
  })
})
