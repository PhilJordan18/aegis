import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../i18n/format'
import { MESSAGES } from '../../i18n/messages'
import type { I18n } from '../../i18n/useI18n'
import { UNRECOGNIZED } from '../catalog/contract'
import {
  asLastKnown,
  chipRole,
  connectionChip,
  connectionNote,
  doorState,
  enabledState,
  hasUnrecognizedValue,
  linkState,
  lockState,
  readerState,
  usableTimeZone,
  windowView,
} from './lockerPresentation'
import { A1, lockerStatus } from './testFixtures'

const fr: I18n = { locale: 'fr', m: MESSAGES.fr, format: formattersFor('fr') }
const en: I18n = { locale: 'en', m: MESSAGES.en, format: formattersFor('en') }
const plain = (value: string | null) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')

describe('connection chip', () => {
  it('uses the approved connection words and a distinct symbol per state, never one symbol for two states', () => {
    const chips = (['ONLINE', 'OFFLINE', 'UNKNOWN'] as const).map((status) => connectionChip(status, fr))
    expect(chips.map((chip) => chip.label)).toEqual(['En ligne', 'Hors ligne', 'État inconnu'])
    expect(new Set(chips.map((chip) => chip.icon)).size).toBe(3)
    expect(new Set(chips.map((chip) => chip.role)).size).toBe(3)
    expect(connectionChip('ONLINE', en).label).toBe('Online')
  })

  it('draws an unrecognized value as unknown and unavailable, never as online', () => {
    const chip = connectionChip(UNRECOGNIZED, fr)
    expect(chip).toMatchObject({ role: 'unknown', label: 'État indisponible' })
    expect(chip.role).not.toBe('ready')
  })

  it('explains OFFLINE and UNKNOWN and says nothing for ONLINE or an unrecognized value', () => {
    expect(connectionNote('ONLINE', fr)).toBeNull()
    expect(connectionNote('OFFLINE', fr)).toContain('signal')
    expect(connectionNote('UNKNOWN', fr)).toContain("n'est pas connu")
    expect(connectionNote(UNRECOGNIZED, fr)).toBeNull()
  })
})

describe('last known state', () => {
  it('draws any value neutral and keeps its text and symbol, whatever the tone it had', () => {
    for (const view of [linkState('DISCONNECTED', fr), readerState('FAULTED', fr), doorState('OPEN', fr), lockState('UNKNOWN', fr), doorState('CLOSED', fr)]) {
      const known = asLastKnown(view)
      expect(known.tone).toBe('neutral')
      expect(chipRole(known.tone)).toBeNull()
      expect(known.label).toBe(view.label)
    }
  })
})

describe('compartment states', () => {
  it('draws the nominal values as plain text and every exception as a chip with a symbol and a text', () => {
    expect(chipRole(linkState('CONNECTED', fr).tone)).toBeNull()
    expect(chipRole(readerState('HEALTHY', fr).tone)).toBeNull()
    expect(chipRole(doorState('CLOSED', fr).tone)).toBeNull()
    expect(chipRole(lockState('LOCKED', fr).tone)).toBeNull()
    expect(chipRole(linkState('DISCONNECTED', fr).tone)).toBe('blocked')
    expect(chipRole(readerState('FAULTED', fr).tone)).toBe('blocked')
    expect(chipRole(doorState('OPEN', fr).tone)).toBe('info')
    expect(chipRole(lockState('UNLOCKED', fr).tone)).toBe('info')
    for (const state of [linkState('UNKNOWN', fr), readerState('UNKNOWN', fr), doorState('UNKNOWN', fr), lockState('UNKNOWN', fr)]) {
      expect(chipRole(state.tone)).toBe('unknown')
      expect(state.label).toBeTruthy()
    }
  })

  it('draws an unrecognized value as unknown whatever the column, never as the healthy one', () => {
    for (const state of [linkState(UNRECOGNIZED, fr), readerState(UNRECOGNIZED, fr), doorState(UNRECOGNIZED, fr), lockState(UNRECOGNIZED, fr)]) {
      expect(state).toMatchObject({ tone: 'unknown', label: 'État indisponible' })
    }
  })

  it('writes the values in both languages', () => {
    expect(doorState('OPEN', fr).label).toBe('Ouverte')
    expect(doorState('OPEN', en).label).toBe('Open')
    expect(lockState('UNLOCKED', fr).label).toBe('Déverrouillée')
    expect(readerState('FAULTED', en).label).toBe('Faulted')
    expect(enabledState(false, fr)).toMatchObject({ tone: 'neutral', label: 'Non' })
  })

  it('detects an unrecognized value anywhere in the locker', () => {
    expect(hasUnrecognizedValue(lockerStatus())).toBe(false)
    expect(hasUnrecognizedValue(lockerStatus({ connectionStatus: UNRECOGNIZED }))).toBe(true)
    expect(hasUnrecognizedValue(lockerStatus({ compartments: [{ ...A1, doorState: UNRECOGNIZED }] }))).toBe(true)
  })
})

describe('operating window', () => {
  it('shows an open window with its closing instant in the locker zone, with the zone abbreviation', () => {
    const view = windowView({ timeZone: 'America/Toronto', open: true, closesAt: '2026-11-03T22:00:00Z', nextOpensAt: null }, fr)
    expect(view.kind).toBe('open')
    expect(plain(view.closesAt)).toBe('3 nov. 2026, 17 h 00 HNE')
    expect(view.nextOpensAt).toBeNull()
    expect(view.zone).toBe('America/Toronto')
  })

  it('shows a closed window with its next opening, in the locker zone whatever the device zone', () => {
    const view = windowView({ timeZone: 'America/Toronto', open: false, closesAt: null, nextOpensAt: '2026-11-04T13:00:00Z' }, en)
    expect(view.kind).toBe('closed')
    expect(plain(view.nextOpensAt)).toMatch(/^Nov 4, 2026, 8:00 a\.m\. EST$/)
    expect(view.closesAt).toBeNull()
  })

  it('says there is no schedule when the server has none, and invents no instant', () => {
    const view = windowView({ timeZone: null, open: false, closesAt: null, nextOpensAt: null }, fr)
    expect(view).toEqual({ kind: 'noSchedule', zone: null, closesAt: null, nextOpensAt: null })
  })

  it('does not compute an open window from the instants: `open` is the server verdict', () => {
    const view = windowView({ timeZone: 'America/Toronto', open: false, closesAt: '2026-11-03T22:00:00Z', nextOpensAt: '2026-11-04T13:00:00Z' }, fr)
    expect(view.kind).toBe('closed')
    expect(view.closesAt).toBeNull()
  })

  it('falls back to the device zone for an identifier the browser does not know, instead of throwing', () => {
    expect(() => usableTimeZone('Mars/Olympus')).not.toThrow()
    expect(usableTimeZone('Mars/Olympus')).toBe(usableTimeZone(null))
    expect(usableTimeZone('America/Toronto')).toBe('America/Toronto')
  })
})
