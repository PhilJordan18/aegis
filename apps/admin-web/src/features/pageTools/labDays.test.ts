import { describe, expect, it } from 'vitest'
import { labToday, lastDays, shiftDay } from './labDays'

describe('laboratory days', () => {
  it('reads today in the laboratory zone, not UTC', () => {
    // 03:30 UTC on 11 Nov is still 10 Nov in Toronto.
    expect(labToday(new Date('2026-11-11T03:30:00Z'))).toBe('2026-11-10')
  })
  it('ends the shortcuts today, both bounds inclusive', () => {
    const now = new Date('2026-11-10T15:00:00Z')
    expect(lastDays(1, now)).toEqual({ from: '2026-11-10', to: '2026-11-10' })
    expect(lastDays(7, now)).toEqual({ from: '2026-11-04', to: '2026-11-10' })
    expect(lastDays(30, now)).toEqual({ from: '2026-10-12', to: '2026-11-10' })
  })
  it('crosses months and the daylight-saving change', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDay('2026-03-08', 1)).toBe('2026-03-09')
  })
})
