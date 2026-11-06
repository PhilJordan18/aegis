import { describe, expect, it } from 'vitest'
import { instantToZonedInput, resolveZonedInput, utcOffsetLabel } from './zonedTime'

const ZONE = 'America/Toronto'

describe('zoned wall-clock input', () => {
  it('shows an instant in the named zone, never the browser one', () => {
    expect(instantToZonedInput('2026-12-01T05:00:00Z', ZONE)).toBe('2026-12-01T00:00')
    expect(instantToZonedInput('2026-07-01T16:30:00.123456Z', ZONE)).toBe('2026-07-01T12:30')
    expect(instantToZonedInput('not an instant', ZONE)).toBeNull()
  })

  it('reads a normal wall time as one exact instant, in and out of daylight saving time', () => {
    expect(resolveZonedInput('2026-12-01T00:00', ZONE)).toEqual({ kind: 'exact', instant: '2026-12-01T05:00:00Z' })
    expect(resolveZonedInput('2026-07-01T12:30', ZONE)).toEqual({ kind: 'exact', instant: '2026-07-01T16:30:00Z' })
    // Either side of each change stays exact.
    expect(resolveZonedInput('2026-03-08T01:59', ZONE)).toEqual({ kind: 'exact', instant: '2026-03-08T06:59:00Z' })
    expect(resolveZonedInput('2026-03-08T03:00', ZONE)).toEqual({ kind: 'exact', instant: '2026-03-08T07:00:00Z' })
    expect(resolveZonedInput('2026-11-01T00:59', ZONE)).toEqual({ kind: 'exact', instant: '2026-11-01T04:59:00Z' })
    expect(resolveZonedInput('2026-11-01T02:00', ZONE)).toEqual({ kind: 'exact', instant: '2026-11-01T07:00:00Z' })
  })

  it('refuses a wall time skipped by the spring change instead of moving it after the gap', () => {
    // 2026-03-08: clocks go from 02:00 EST to 03:00 EDT, so 02:00 to 02:59 never happen in Toronto.
    expect(resolveZonedInput('2026-03-08T02:30', ZONE)).toEqual({ kind: 'nonexistent' })
    expect(resolveZonedInput('2026-03-08T02:00', ZONE)).toEqual({ kind: 'nonexistent' })
  })

  it('offers both instants of a wall time repeated by the autumn change, distinguishable by their offset', () => {
    // 2026-11-01: 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    const resolved = resolveZonedInput('2026-11-01T01:30', ZONE)
    expect(resolved).toEqual({ kind: 'ambiguous', earlier: '2026-11-01T05:30:00Z', later: '2026-11-01T06:30:00Z' })
    expect(utcOffsetLabel('2026-11-01T05:30:00Z', ZONE)).toBe('UTC−04:00')
    expect(utcOffsetLabel('2026-11-01T06:30:00Z', ZONE)).toBe('UTC−05:00')
    expect(utcOffsetLabel('2026-07-01T00:00:00Z', 'Asia/Kolkata')).toBe('UTC+05:30')
  })

  it('round-trips every instant, the selected occurrence included', () => {
    for (const instant of ['2026-03-08T06:59:00Z', '2026-03-08T07:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2027-01-31T23:59:00Z']) {
      const input = instantToZonedInput(instant, ZONE)
      expect(input).not.toBeNull()
      const back = resolveZonedInput(input ?? '', ZONE)
      const instants = back.kind === 'exact' ? [back.instant] : back.kind === 'ambiguous' ? [back.earlier, back.later] : []
      expect(instants).toContain(instant)
    }
  })

  it('refuses unreadable values and impossible dates', () => {
    for (const value of ['', '2026-02-30T10:00', '2026-13-01T10:00', '2026-12-01 10:00', '2026-12-01T24:00']) {
      expect(resolveZonedInput(value, ZONE)).toEqual({ kind: 'invalid' })
    }
  })

  it('follows another zone’s rules, not the browser’s', () => {
    // Europe/Paris changes on 2026-03-29 at 02:00 and on 2026-10-25 at 03:00.
    expect(resolveZonedInput('2026-03-29T02:30', 'Europe/Paris')).toEqual({ kind: 'nonexistent' })
    expect(resolveZonedInput('2026-10-25T02:30', 'Europe/Paris')).toEqual({ kind: 'ambiguous', earlier: '2026-10-25T00:30:00Z', later: '2026-10-25T01:30:00Z' })
  })
})
