import { describe, expect, it } from 'vitest'
import { windowTime } from './summaryBand'

const plain = (value: string) => value.replace(/[\u00A0\u202F]/g, ' ')

describe('windowTime (contract §8.1)', () => {
  it('names the time alone on the lab day of the evaluation', () => {
    expect(plain(windowTime('2026-11-26T22:00:00Z', '2026-11-26T14:00:00Z', 'America/Toronto', { locale: 'fr' }))).toBe('17 h 00')
  })

  it('adds the weekday on another day, never the full date', () => {
    expect(plain(windowTime('2026-11-30T13:00:00Z', '2026-11-26T14:00:00Z', 'America/Toronto', { locale: 'fr' }))).toBe('lun. 8 h 00')
    expect(plain(windowTime('2026-11-30T13:00:00Z', '2026-11-26T14:00:00Z', 'America/Toronto', { locale: 'en' }))).toMatch(/^Mon 8:00 a\.m\.$/)
  })

  it('compares days in the locker zone, not in UTC', () => {
    // 02:00 UTC on the 27th is still the 26th in Toronto.
    expect(plain(windowTime('2026-11-27T02:00:00Z', '2026-11-26T14:00:00Z', 'America/Toronto', { locale: 'fr' }))).toBe('21 h 00')
  })
})
