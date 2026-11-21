import type { I18n } from '../../i18n/useI18n'

const COMMAND_REJECTED_PREFIX = 'COMMAND_REJECTED_'

function lookup(table: Readonly<Record<string, string>>, code: string): string | null {
  return Object.hasOwn(table, code) ? (table[code] ?? null) : null
}

/**
 * The readable meaning of a failure or audit reason (09 §8.5, §15.5, §19.1), or null for a value this version does not
 * know. The server sends the code as free text (G12): callers keep the code visible beside the label and show the code
 * alone when there is no label. A reason that is also an anomaly type reads the anomaly catalog, so that a type has
 * one wording on every screen. Nothing is inferred about the physical state from an unknown reason (09 §3).
 */
export function failureReasonLabel(code: string, { m }: I18n): string | null {
  if (code.startsWith(COMMAND_REJECTED_PREFIX) && code.length > COMMAND_REJECTED_PREFIX.length) return m.reservations.commandRejectedReason
  return lookup(m.reservations.failureReasonLabel, code) ?? lookup(m.anomalies.type, code)
}
