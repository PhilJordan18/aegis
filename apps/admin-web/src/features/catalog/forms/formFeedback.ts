import type { I18n } from '../../../i18n/useI18n'
import type { MutationFailure } from '../mutationFailure'

/** Field limits of 09 §12.1–12.2, anticipated by the forms; the server stays the authority. */
export const LIMITS = { modelName: 160, manufacturer: 120, modelNumber: 120, description: 2000, assetCode: 64, serialNumber: 120 } as const

export interface FormAlertContent {
  readonly title: string
  readonly body: string | null
  readonly traceId: string | null
  /** Retrying the same intent is safe and may succeed (no answer, first attempt still running). */
  readonly retryable: boolean
}

export interface FormFeedback {
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly alert: FormAlertContent | null
}

type RefusalCode = keyof I18n['m']['catalogEdit']['refusal']

/** A uniqueness conflict belongs to the field that carries the value (09 §12.1–12.2). */
const REFUSAL_FIELD: Partial<Record<RefusalCode, string>> = {
  ASSET_MODEL_NAME_ALREADY_EXISTS: 'name',
  ASSET_CODE_ALREADY_EXISTS: 'assetCode',
  ASSET_SERIAL_NUMBER_ALREADY_EXISTS: 'serialNumber',
}

function isRefusalCode(code: string, { m }: I18n): code is RefusalCode {
  return Object.hasOwn(m.catalogEdit.refusal, code)
}

/** Message of one violation code (09 §7.1) for a field whose limit is `max`. An unknown code stays generic. */
export function violationMessage(code: string, max: number | undefined, { m }: I18n): string {
  const v = m.catalogEdit.violation
  switch (code) {
    case 'REQUIRED':
    case 'NOT_NULL':
    case 'NOT_BLANK':
      return v.required
    case 'SIZE':
      return max === undefined ? v.invalid : v.tooLong({ max })
    case 'INVALID_VALUE':
      return v.invalid
    case 'ASSET_MODEL_NOT_ACTIVE':
      return v.modelNotActive
    case 'REQUIRED_WHEN_CALIBRATION_REQUIRED':
      return v.calibrationDueRequired
    case 'NOT_ALLOWED_WITHOUT_CALIBRATION':
      return v.calibrationDueNotAllowed
    default:
      return v.refused
  }
}

/**
 * Turns a failed mutation into field errors and one form-level alert. `fields` maps the contract's field names
 * to their limits: a violation on another field (or `body`) is reported in the alert, with the trace ID.
 */
export function feedbackFor(failure: MutationFailure, fields: Readonly<Record<string, number | undefined>>, i18n: I18n): FormFeedback {
  const t = i18n.m.catalogEdit
  const none = { fieldErrors: {}, alert: null }
  switch (failure.kind) {
    case 'ended':
      return none
    case 'unreachable':
      return { fieldErrors: {}, alert: { title: t.unreachableTitle, body: t.unreachableBody, traceId: null, retryable: true } }
    case 'inProgress':
      return { fieldErrors: {}, alert: { title: t.inProgressTitle, body: t.inProgressBody, traceId: null, retryable: true } }
    case 'forbidden':
      return { fieldErrors: {}, alert: { title: t.forbiddenTitle, body: t.refusedBody, traceId: null, retryable: false } }
    case 'notFound':
      return { fieldErrors: {}, alert: { title: t.notFoundTitle, body: t.refusedBody, traceId: null, retryable: false } }
    case 'serviceError':
      return { fieldErrors: {}, alert: { title: t.serviceErrorTitle, body: null, traceId: failure.traceId, retryable: false } }
    case 'validation': {
      const fieldErrors: Record<string, string> = {}
      let other = false
      for (const { field, code } of failure.violations) {
        if (Object.hasOwn(fields, field)) fieldErrors[field] ??= violationMessage(code, fields[field], i18n)
        else other = true
      }
      const known = Object.keys(fieldErrors).length > 0
      return {
        fieldErrors,
        alert: { title: other || !known ? t.validationOtherTitle : t.validationTitle, body: null, traceId: other || !known ? failure.traceId : null, retryable: false },
      }
    }
    case 'refused': {
      if (!isRefusalCode(failure.code, i18n)) return { fieldErrors: {}, alert: { title: t.refusedTitle, body: t.refusedBody, traceId: failure.traceId, retryable: false } }
      const message = t.refusal[failure.code]
      const field = REFUSAL_FIELD[failure.code]
      if (field !== undefined && Object.hasOwn(fields, field)) {
        return { fieldErrors: { [field]: message }, alert: { title: t.validationTitle, body: null, traceId: null, retryable: false } }
      }
      return { fieldErrors: {}, alert: { title: message, body: t.refusedBody, traceId: null, retryable: false } }
    }
  }
}
