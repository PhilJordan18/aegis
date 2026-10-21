import type { ProblemResponse, ProblemViolation } from '../features/auth/contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function parseViolation(value: unknown): ProblemViolation | null {
  if (!isRecord(value) || !isString(value.field) || !isString(value.code) || !isString(value.message)) return null
  return { field: value.field, code: value.code, message: value.message }
}

/**
 * Reads a 09 §7 problem body. Returns null for anything that is not a complete
 * problem, so callers fall back to the HTTP status instead of guessing a code.
 */
export function parseProblem(body: unknown): ProblemResponse | null {
  if (!isRecord(body)) return null
  const { type, title, status, code, detail, instance, traceId, timestamp, reasons, violations } = body
  if (
    !isString(type) ||
    !isString(title) ||
    typeof status !== 'number' ||
    !isString(code) ||
    code === '' ||
    !isString(detail) ||
    !isString(instance) ||
    !isString(traceId) ||
    !isString(timestamp)
  ) {
    return null
  }
  if (reasons !== undefined && reasons !== null && !(Array.isArray(reasons) && reasons.every(isString))) return null
  let parsedViolations: ProblemViolation[] | undefined
  if (violations !== undefined && violations !== null) {
    if (!Array.isArray(violations)) return null
    parsedViolations = []
    for (const violation of violations) {
      const parsed = parseViolation(violation)
      if (parsed === null) return null
      parsedViolations.push(parsed)
    }
  }
  return {
    type,
    title,
    status,
    code,
    detail,
    instance,
    traceId,
    timestamp,
    ...(Array.isArray(reasons) ? { reasons: reasons as string[] } : {}),
    ...(parsedViolations ? { violations: parsedViolations } : {}),
  }
}
