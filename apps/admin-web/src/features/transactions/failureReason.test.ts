import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../i18n/format'
import { MESSAGES } from '../../i18n/messages'
import type { I18n } from '../../i18n/useI18n'
import { parseLockerOperationView } from './contractParsers'
import { failureReasonLabel } from './failureReason'
import { lockerOperationView } from './testFixtures'

const i18n = (locale: 'fr' | 'en'): I18n => ({ locale, m: MESSAGES[locale], format: formattersFor(locale) })

/** Every reason of 09 §8.5 and §15.5, plus the values of the stack integration ref `43fed3c` and the approved rule 3. */
const KNOWN = [
  'LOCAL_PROOF_EXPIRED',
  'HUB_RESTARTED',
  'LOCKER_OFFLINE',
  'LOCAL_PROOF_ATTEMPTS_EXHAUSTED',
  'RESERVATION_CANCELLED',
  'OPERATION_EXPIRED',
  'DOOR_NOT_CLOSED_BEFORE_EXPIRY',
  'INCONSISTENT_PHYSICAL_STATE',
  'DEVICE_OFFLINE_DURING_OPERATION',
  'EXPECTED_ASSET_NOT_OBSERVED',
  'UNEXPECTED_ASSET_OBSERVED',
  'COMMAND_REJECTED_LOCK_ACTUATION_FAILED',
  'LOCAL_PROOF_GUARD_FAILED',
  'LOCAL_PROOF_INVALID',
  'LOCAL_PROOF_MALFORMED',
  'LOCAL_PROOF_ALREADY_USED',
  'LOCAL_PROOF_NOT_DISPLAYED',
  'LOCAL_PROOF_CONTEXT_MISMATCH',
  'LOCAL_PROOF_INVALIDATED',
  'LOCAL_PROOF_RATE_LIMITED',
  'COMMAND_CORRELATION_INVALID',
]

describe('failureReasonLabel', () => {
  it('labels every known reason in both languages', () => {
    for (const locale of ['fr', 'en'] as const) for (const code of KNOWN) expect(failureReasonLabel(code, i18n(locale)), `${locale} ${code}`).not.toBeNull()
  })

  it('labels the definitive guard refusal at scan of rule 3', () => {
    expect(failureReasonLabel('LOCAL_PROOF_GUARD_FAILED', i18n('fr'))).toBe('Contrôle refusé au scan : tentative terminée')
    expect(failureReasonLabel('LOCAL_PROOF_GUARD_FAILED', i18n('en'))).toBe('Check refused at the scan: attempt ended')
  })

  it('reads the anomaly catalog for a reason that is an anomaly type, including the offline decision of 21 November 2026', () => {
    expect(failureReasonLabel('DEVICE_OFFLINE_DURING_OPERATION', i18n('fr'))).toBe("Casier hors ligne ou issue physique indéterminée pendant l'opération")
    expect(failureReasonLabel('DEVICE_OFFLINE_DURING_OPERATION', i18n('en'))).toBe('Locker offline or physical outcome undetermined during the operation')
    expect(failureReasonLabel('EXPECTED_ASSET_NOT_OBSERVED', i18n('fr'))).toBe(MESSAGES.fr.anomalies.type.EXPECTED_ASSET_NOT_OBSERVED)
  })

  it('labels COMMAND_REJECTED_<result> without hiding the hub result, which stays in the code', () => {
    expect(failureReasonLabel('COMMAND_REJECTED_CLOCK_NOT_SYNCHRONIZED', i18n('fr'))).toBe('Commande refusée par le casier')
    expect(failureReasonLabel('COMMAND_REJECTED_CLOCK_NOT_SYNCHRONIZED', i18n('en'))).toBe('Command refused by the locker')
  })

  it('has no label for a value this version does not know, and never takes an object key for a code', () => {
    expect(failureReasonLabel('SOMETHING_NEW', i18n('fr'))).toBeNull()
    expect(failureReasonLabel('COMMAND_REJECTED_', i18n('fr'))).toBeNull()
    expect(failureReasonLabel('', i18n('fr'))).toBeNull()
    expect(failureReasonLabel('constructor', i18n('en'))).toBeNull()
    expect(failureReasonLabel('__proto__', i18n('en'))).toBeNull()
    expect(failureReasonLabel('toString', i18n('en'))).toBeNull()
  })

  it('never offers an unlock wording', () => {
    for (const locale of ['fr', 'en'] as const) {
      for (const code of KNOWN) expect(failureReasonLabel(code, i18n(locale)) ?? '').not.toMatch(/déverrouill|unlock/i)
    }
  })
})

describe('the operation parser and a failure reason', () => {
  it('accepts LOCAL_PROOF_GUARD_FAILED as it is sent, like any other server text', () => {
    const parsed = parseLockerOperationView(lockerOperationView({ status: 'FAILED', failureReason: 'LOCAL_PROOF_GUARD_FAILED', confirmedAt: null }))
    expect(parsed?.failureReason).toBe('LOCAL_PROOF_GUARD_FAILED')
    expect(parsed?.status).toBe('FAILED')
  })

  it('accepts a reason it does not know, which then has no label', () => {
    const parsed = parseLockerOperationView(lockerOperationView({ status: 'FAILED', failureReason: 'FUTURE_REASON', confirmedAt: null }))
    expect(parsed?.failureReason).toBe('FUTURE_REASON')
  })
})
