import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../i18n/format'
import { MESSAGES } from '../../i18n/messages'
import type { Locale } from '../../i18n/locale'
import type { I18n } from '../../i18n/useI18n'
import { availabilityLabel, availabilityRole, calibrationDueLabel, calibrationLabel, diagnosticChip, diagnosticTone, evaluatedAtLabel, factsLine, hasUnrecognizedValue, reasonLabel } from './assetPresentation'
import { asset, MM001, MM002 } from './testFixtures'

const i18n = (locale: Locale): I18n => ({ locale, m: MESSAGES[locale], format: formattersFor(locale) })
const plain = (value: string) => value.replace(/[\u00A0\u202F]/g, ' ')

describe('diagnosticTone', () => {
  it('says none only for an empty list, and never reads it as ready', () => {
    expect(diagnosticTone([])).toBe('none')
    expect(plain(diagnosticChip(asset({ id: 'a', assetCode: 'X', operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: [] } }), i18n('fr')).label)).toBe('Aucun empêchement détecté')
  })

  it('is unknown when the only reason is the unknown physical state', () => {
    expect(diagnosticTone(['UNKNOWN_PHYSICAL_STATE'])).toBe('unknown')
  })

  it('is blocked as soon as a known blocker is present', () => {
    expect(diagnosticTone(['CALIBRATION_EXPIRED', 'UNKNOWN_PHYSICAL_STATE'])).toBe('blocked')
    expect(diagnosticTone(['NOT_AVAILABLE'])).toBe('blocked')
  })
})

describe('labels', () => {
  it('counts blockers with the language plural rules', () => {
    expect(plain(diagnosticChip(MM001, i18n('fr')).label)).toBe('1 empêchement')
    expect(plain(diagnosticChip(MM002, i18n('fr')).label)).toBe('2 empêchements')
    expect(plain(diagnosticChip(MM002, i18n('en')).label)).toBe('2 blockers')
  })

  it('says since when a calibration expired, in the laboratory zone and the language', () => {
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', MM002, i18n('fr')))).toBe('Calibration expirée depuis le 8 sept. 2026, 00 h 00 HAE')
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', MM002, i18n('en')))).toBe('Calibration expired on Sep 8, 2026, 12:00 a.m. EDT')
    // 2026-09-09T02:30Z is already 9 September in UTC but still the evening of 8 September in Toronto.
    const lateEvening = asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt: '2026-09-09T02:30:00Z', status: 'EXPIRED' } })
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', lateEvening, i18n('fr')))).toBe('Calibration expirée depuis le 8 sept. 2026, 22 h 30 HAE')
  })

  it('keeps the date and the time with its zone each on one line, and may break after the comma', () => {
    const label = reasonLabel('CALIBRATION_EXPIRED', MM002, i18n('fr'))
    expect(label).toMatch(/8\u00A0sept\.\u00A02026, 00[\u00A0\u202F]h[\u00A0\u202F]00\u00A0HAE$/)
    expect(label.split(', ')).toHaveLength(2)
  })

  it('uses the plain reason when an expired calibration carries no due instant', () => {
    const noDate = asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt: null, status: 'EXPIRED' } })
    expect(reasonLabel('CALIBRATION_EXPIRED', noDate, i18n('fr'))).toBe('Calibration expirée')
  })

  it('describes each calibration status', () => {
    expect(plain(calibrationLabel(MM001, i18n('fr')))).toBe("Valide jusqu'au 1 déc. 2026, 00 h 00 HNE")
    expect(plain(calibrationLabel(MM001, i18n('en')))).toBe('Valid until Dec 1, 2026, 12:00 a.m. EST')
    expect(plain(calibrationLabel(MM002, i18n('en')))).toBe('Expired on Sep 8, 2026, 12:00 a.m. EDT')
    expect(calibrationLabel(asset({ id: 'a', assetCode: 'X', calibration: { required: false, dueAt: null, status: 'NOT_REQUIRED' } }), i18n('en'))).toBe('Not required')
    expect(calibrationLabel(asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt: null, status: 'UNKNOWN' } }), i18n('fr'))).toBe('Échéance non renseignée')
  })

  it('writes presence as unknown, never as a place, when nothing was observed', () => {
    expect(factsLine(MM001, i18n('fr'))).toBe('Disponible · Présence inconnue · En service')
    expect(factsLine(MM001, i18n('en'))).toBe('Available · Presence unknown · In service')
  })

  it('shows the evaluation instant with its zone, in the device zone', () => {
    expect(evaluatedAtLabel(MM001, i18n('en'))).toMatch(/\d{1,2}:\d{2}\s?[ap]\.m\.\s\S+/)
  })
})

describe('calibration due instant around midnight and daylight-saving changes (America/Toronto)', () => {
  const due = (dueAt: string, status: 'VALID' | 'EXPIRED' = 'VALID') => asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt, status } })

  it.each([
    ['2026-12-01T03:00:00Z', '30 nov. 2026, 22 h 00 HNE', 'Nov 30, 2026, 10:00 p.m. EST'],
    ['2026-09-08T04:00:00Z', '8 sept. 2026, 00 h 00 HAE', 'Sep 8, 2026, 12:00 a.m. EDT'],
    ['2026-11-01T05:30:00Z', '1 nov. 2026, 01 h 30 HAE', 'Nov 1, 2026, 1:30 a.m. EDT'],
    ['2026-11-01T06:30:00Z', '1 nov. 2026, 01 h 30 HNE', 'Nov 1, 2026, 1:30 a.m. EST'],
    ['2026-03-08T06:59:00Z', '8 mars 2026, 01 h 59 HNE', 'Mar 8, 2026, 1:59 a.m. EST'],
    ['2026-03-08T07:00:00Z', '8 mars 2026, 03 h 00 HAE', 'Mar 8, 2026, 3:00 a.m. EDT'],
  ])('shows %s as the laboratory date, time and zone in both languages', (dueAt, fr, en) => {
    expect(plain(calibrationDueLabel(due(dueAt), i18n('fr')))).toBe(fr)
    expect(plain(calibrationDueLabel(due(dueAt), i18n('en')))).toBe(en)
  })

  it('never turns the late evening of 30 November into 1 December, in the dossier line or the reason', () => {
    const evening = due('2026-12-01T03:00:00Z')
    expect(plain(calibrationLabel(evening, i18n('fr')))).toBe("Valide jusqu'au 30 nov. 2026, 22 h 00 HNE")
    const expired = due('2026-12-01T03:00:00Z', 'EXPIRED')
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', expired, i18n('en')))).toBe('Calibration expired on Nov 30, 2026, 10:00 p.m. EST')
  })

  it('shows the two 01:30 of the fall-back hour as different labels', () => {
    for (const locale of ['fr', 'en'] as const) {
      expect(calibrationDueLabel(due('2026-11-01T05:30:00Z'), i18n(locale))).not.toBe(calibrationDueLabel(due('2026-11-01T06:30:00Z'), i18n(locale)))
    }
  })

  it('does not recompute the status from the instant: the server status is the one shown', () => {
    // A due instant far in the past with a VALID status stays « valid »: the client never compares it with now.
    expect(plain(calibrationLabel(due('2020-01-01T00:00:00Z', 'VALID'), i18n('en')))).toBe('Valid until Dec 31, 2019, 7:00 p.m. EST')
  })

  it('shows an absent or unreadable instant as not provided, never as a date', () => {
    expect(calibrationDueLabel(asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt: null, status: 'UNKNOWN' } }), i18n('en'))).toBe('Not provided')
    expect(calibrationDueLabel(due('not-a-date'), i18n('en'))).toBe('Not provided')
  })
})

describe('unrecognized values (09 §3)', () => {
  const unknown = asset({
    id: 'a',
    assetCode: 'X',
    availability: 'UNRECOGNIZED',
    operationalStatus: 'UNRECOGNIZED',
    calibration: { required: true, dueAt: null, status: 'UNRECOGNIZED' },
    operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: ['UNRECOGNIZED'] },
  })

  it('shows an unavailable state in both languages, never a known value', () => {
    expect(reasonLabel('UNRECOGNIZED', unknown, i18n('fr'))).toBe('État indisponible')
    expect(reasonLabel('UNRECOGNIZED', unknown, i18n('en'))).toBe('State unavailable')
    expect(factsLine(unknown, i18n('fr'))).toBe('État indisponible · Présence inconnue · État indisponible')
    expect(calibrationLabel(unknown, i18n('en'))).toBe('State unavailable')
    expect(availabilityLabel('UNRECOGNIZED', i18n('en'))).toBe('State unavailable')
    expect(availabilityRole('UNRECOGNIZED')).toBe('neutral')
  })

  it('counts an unrecognized reason as a blocker rather than hiding it', () => {
    expect(diagnosticTone(['UNRECOGNIZED'])).toBe('blocked')
    expect(plain(diagnosticChip(unknown, i18n('fr')).label)).toBe('1 empêchement')
  })

  it('knows when a note is needed', () => {
    expect(hasUnrecognizedValue(unknown)).toBe(true)
    expect(hasUnrecognizedValue(MM001)).toBe(false)
  })
})
