import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../i18n/format'
import { MESSAGES } from '../../i18n/messages'
import type { Locale } from '../../i18n/locale'
import type { I18n } from '../../i18n/useI18n'
import { calibrationLabel, diagnosticChip, diagnosticTone, evaluatedAtLabel, factsLine, reasonLabel } from './assetPresentation'
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
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', MM002, i18n('fr')))).toBe('Calibration expirée depuis le 8 sept. 2026')
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', MM002, i18n('en')))).toBe('Calibration expired on Sep 8, 2026')
    // 2026-09-08T04:00Z is still 8 September in Toronto and would be the same in UTC: use an instant that differs.
    const lateEvening = asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt: '2026-09-09T02:30:00Z', status: 'EXPIRED' } })
    expect(plain(reasonLabel('CALIBRATION_EXPIRED', lateEvening, i18n('fr')))).toBe('Calibration expirée depuis le 8 sept. 2026')
  })

  it('never splits a date across two lines', () => {
    expect(reasonLabel('CALIBRATION_EXPIRED', MM002, i18n('fr'))).toMatch(/8\u00A0sept\.\u00A02026$/)
  })

  it('uses the plain reason when an expired calibration carries no due instant', () => {
    const noDate = asset({ id: 'a', assetCode: 'X', calibration: { required: true, dueAt: null, status: 'EXPIRED' } })
    expect(reasonLabel('CALIBRATION_EXPIRED', noDate, i18n('fr'))).toBe('Calibration expirée')
  })

  it('describes each calibration status', () => {
    expect(plain(calibrationLabel(MM001, i18n('fr')))).toBe("Valide jusqu'au 1 déc. 2026")
    expect(plain(calibrationLabel(MM002, i18n('en')))).toBe('Expired on Sep 8, 2026')
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
