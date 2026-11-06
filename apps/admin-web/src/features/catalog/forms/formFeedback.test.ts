import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../../i18n/format'
import { MESSAGES } from '../../../i18n/messages'
import type { I18n } from '../../../i18n/useI18n'
import { feedbackFor } from './formFeedback'

const fr: I18n = { locale: 'fr', m: MESSAGES.fr, format: formattersFor('fr') }
const plain = (value: string | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const FIELDS = { assetCode: 64, calibrationDueAt: undefined }

describe('feedbackFor', () => {
  it('puts known violations on their fields and the rest in the alert with the trace ID', () => {
    const result = feedbackFor(
      {
        kind: 'validation',
        traceId: 'trace-1',
        violations: [
          { field: 'assetCode', code: 'SIZE' },
          { field: 'calibrationDueAt', code: 'REQUIRED_WHEN_CALIBRATION_REQUIRED' },
          { field: 'body', code: 'UNKNOWN_FIELD' },
        ],
      },
      FIELDS,
      fr,
    )
    expect(plain(result.fieldErrors.assetCode)).toBe('64 caractères au maximum.')
    expect(plain(result.fieldErrors.calibrationDueAt)).toBe('Indiquez l’échéance : la calibration est requise.')
    expect(result.alert).toMatchObject({ title: 'Une valeur a été refusée par le serveur.', traceId: 'trace-1', retryable: false })
  })

  it('places a uniqueness conflict on its field, and an unknown code stays generic', () => {
    expect(feedbackFor({ kind: 'refused', code: 'ASSET_CODE_ALREADY_EXISTS', traceId: 't' }, FIELDS, fr).fieldErrors).toEqual({
      assetCode: 'Ce code est déjà utilisé, exemplaires archivés compris.',
    })
    expect(feedbackFor({ kind: 'refused', code: 'SOMETHING_NEW', traceId: 't' }, FIELDS, fr).alert).toMatchObject({
      title: 'Le serveur a refusé la demande.',
      traceId: 't',
    })
  })

  it('offers a retry only when the outcome is unknown or still running', () => {
    expect(feedbackFor({ kind: 'unreachable' }, FIELDS, fr).alert?.retryable).toBe(true)
    expect(feedbackFor({ kind: 'inProgress' }, FIELDS, fr).alert?.retryable).toBe(true)
    expect(feedbackFor({ kind: 'forbidden' }, FIELDS, fr).alert?.retryable).toBe(false)
    expect(feedbackFor({ kind: 'ended' }, FIELDS, fr).alert).toBeNull()
  })
})
