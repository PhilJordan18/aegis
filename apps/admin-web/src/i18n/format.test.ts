import { describe, expect, it } from 'vitest'
import { formattersFor } from './format'
import { createPluralSelector } from './plural'

// Intl uses U+00A0 or U+202F inside some results; compare with every space normalised.
const plain = (value: string) => value.replace(/[\u00A0\u202F]/g, ' ')

describe('plural selection (CLDR)', () => {
  const forms = { one: 'one', other: 'other' }

  it('puts 0 and 1 in the French singular', () => {
    const select = createPluralSelector('fr')
    expect(select(0, forms)).toBe('one')
    expect(select(1, forms)).toBe('one')
    expect(select(2, forms)).toBe('other')
    expect(select(42, forms)).toBe('other')
  })

  it('puts only 1 in the English singular', () => {
    const select = createPluralSelector('en')
    expect(select(0, forms)).toBe('other')
    expect(select(1, forms)).toBe('one')
    expect(select(2, forms)).toBe('other')
  })

  it('uses `other` for a category without its own form', () => {
    // French « 1 000 000 » is `many`; no form is given for it.
    expect(createPluralSelector('fr')(1_000_000, forms)).toBe('other')
  })
})

describe('durations', () => {
  it.each([
    ['fr', 0, '0 seconde'],
    ['fr', 1, '1 seconde'],
    ['fr', 2, '2 secondes'],
    ['fr', 55, '55 secondes'],
    ['en', 0, '0 seconds'],
    ['en', 1, '1 second'],
    ['en', 2, '2 seconds'],
    ['en', 55, '55 seconds'],
  ] as const)('%s, %i seconds', (locale, value, expected) => {
    expect(plain(formattersFor(locale).seconds(value))).toBe(expected)
  })

  it('groups large values with the locale separator', () => {
    expect(plain(formattersFor('fr').seconds(86_400))).toBe('86 400 secondes')
    expect(plain(formattersFor('en').seconds(86_400))).toBe('86,400 seconds')
  })

  it.each([
    [0, '0:00'],
    [3, '0:03'],
    [59, '0:59'],
    [60, '1:00'],
    [65, '1:05'],
    [3599, '59:59'],
  ])('countdown clock %i s is %s in both languages', (value, expected) => {
    expect(formattersFor('fr').clock(value)).toBe(expected)
    expect(formattersFor('en').clock(value)).toBe(expected)
  })

  it('never shows a negative countdown', () => {
    expect(formattersFor('en').clock(-4)).toBe('0:00')
  })
})

describe('dates', () => {
  const instant = new Date('2026-10-21T19:20:00Z')

  it('formats a date in each language', () => {
    expect(plain(formattersFor('fr').date(instant, 'America/Toronto'))).toBe('21 oct. 2026')
    expect(plain(formattersFor('en').date(instant, 'America/Toronto'))).toBe('Oct 21, 2026')
  })

  it('uses the explicit time zone, whatever the language: late evening in Toronto is already tomorrow in UTC', () => {
    const lateEvening = new Date('2026-10-22T02:30:00Z')
    for (const locale of ['fr', 'en'] as const) {
      const toronto = formattersFor(locale).date(lateEvening, 'America/Toronto')
      const utc = formattersFor(locale).date(lateEvening, 'UTC')
      expect(toronto).not.toBe(utc)
    }
    expect(plain(formattersFor('en').date(lateEvening, 'America/Toronto'))).toBe('Oct 21, 2026')
    expect(plain(formattersFor('en').date(lateEvening, 'UTC'))).toBe('Oct 22, 2026')
  })

  it('formats the illustrative calibration date of the landing page', () => {
    const expiry = new Date('2026-09-08T12:00:00Z')
    expect(plain(formattersFor('fr').date(expiry, 'UTC'))).toBe('8 sept. 2026')
    expect(plain(formattersFor('en').date(expiry, 'UTC'))).toBe('Sep 8, 2026')
  })
})

describe('business instants (date, time and zone)', () => {
  // Cases around midnight and the daylight-saving changes of America/Toronto, 2026. They hold whatever
  // zone the machine runs in: the zone is an argument, never the host's.
  const ZONE = 'America/Toronto'
  const cases = [
    ['evening before midnight stays on the previous day', '2026-12-01T03:00:00Z', '30 nov. 2026, 22 h 00 HNE', 'Nov 30, 2026, 10:00 p.m. EST'],
    ['local midnight of a summer day', '2026-09-08T04:00:00Z', '8 sept. 2026, 00 h 00 HAE', 'Sep 8, 2026, 12:00 a.m. EDT'],
    ['fall back, first 01:30', '2026-11-01T05:30:00Z', '1 nov. 2026, 01 h 30 HAE', 'Nov 1, 2026, 1:30 a.m. EDT'],
    ['fall back, second 01:30', '2026-11-01T06:30:00Z', '1 nov. 2026, 01 h 30 HNE', 'Nov 1, 2026, 1:30 a.m. EST'],
    ['spring forward, last minute before', '2026-03-08T06:59:00Z', '8 mars 2026, 01 h 59 HNE', 'Mar 8, 2026, 1:59 a.m. EST'],
    ['spring forward, first minute after', '2026-03-08T07:00:00Z', '8 mars 2026, 03 h 00 HAE', 'Mar 8, 2026, 3:00 a.m. EDT'],
  ] as const

  it.each(cases)('%s (%s)', (_name, iso, fr, en) => {
    const instant = new Date(iso)
    expect(plain(formattersFor('fr').dateTime(instant, ZONE))).toBe(fr)
    expect(plain(formattersFor('en').dateTime(instant, ZONE))).toBe(en)
  })

  it('tells the two 01:30 of the November change apart by the zone abbreviation', () => {
    for (const locale of ['fr', 'en'] as const) {
      const first = formattersFor(locale).dateTime(new Date('2026-11-01T05:30:00Z'), ZONE)
      const second = formattersFor(locale).dateTime(new Date('2026-11-01T06:30:00Z'), ZONE)
      expect(first).not.toBe(second)
    }
  })

  it('never reads 22:00 on 30 November as 1 December', () => {
    const instant = new Date('2026-12-01T03:00:00Z')
    expect(plain(formattersFor('en').dateTime(instant, ZONE))).not.toContain('Dec')
    expect(plain(formattersFor('en').dateTime(instant, 'UTC'))).toBe('Dec 1, 2026, 3:00 a.m. UTC')
  })
})

describe('times', () => {
  const instant = new Date('2026-10-21T19:20:00Z')

  it('shows the zone abbreviation next to the time, in the zone it is given', () => {
    expect(plain(formattersFor('fr').time(instant, 'America/Toronto'))).toBe('15 h 20 HAE')
    expect(plain(formattersFor('en').time(instant, 'America/Toronto'))).toBe('3:20 p.m. EDT')
  })

  it('moves the same instant to another zone instead of keeping the digits', () => {
    expect(plain(formattersFor('en').time(instant, 'UTC'))).toMatch(/^7:20 p\.m\. UTC$/)
  })
})

describe('capitalisation', () => {
  it('upper-cases an initial with the language rules', () => {
    expect(formattersFor('fr').upperCase('é')).toBe('É')
    expect(formattersFor('en').upperCase('a')).toBe('A')
  })
})
