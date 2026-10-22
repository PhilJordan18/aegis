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
