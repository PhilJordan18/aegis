import type { ProblemViolation } from './contract'

/** states.md §2: a request still pending after 15 s is abandoned and reported as unreachable. */
export const SIGN_IN_TIMEOUT_MS = 15_000
const MAX_EMAIL_LENGTH = 320
// Feedback only; the server validates and normalises (09 §10.2).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A field error is a code, never a sentence: the page turns it into text in the
 * current language (catalog `signIn.fieldError`), so a language switch updates it.
 */
export type FieldErrorCode = 'emailRequired' | 'emailInvalid' | 'emailTooLong' | 'passwordRequired' | 'passwordRejected'

export interface FieldErrors {
  readonly email?: FieldErrorCode
  readonly password?: FieldErrorCode
}

/** Client validation (states.md §3 `validation`): no request is sent while this returns errors. */
export function validateSignIn(email: string, password: string): FieldErrors {
  const trimmed = email.trim()
  const emailError =
    trimmed === ''
      ? 'emailRequired'
      : trimmed.length > MAX_EMAIL_LENGTH
        ? 'emailTooLong'
        : EMAIL_PATTERN.test(trimmed)
          ? undefined
          : 'emailInvalid'
  return {
    ...(emailError ? { email: emailError } : {}),
    ...(password === '' ? { password: 'passwordRequired' as const } : {}),
  }
}

/**
 * Server 400: errors are chosen by field, never taken from `violations[].message`.
 * When the client also flags the field, its more precise message wins (review R5).
 */
export function errorsFromViolations(
  violations: readonly ProblemViolation[],
  submitted: { email: string; password: string },
): { errors: FieldErrors; unknown: boolean } {
  const fields = new Set(violations.map((violation) => violation.field))
  const local = validateSignIn(submitted.email, submitted.password)
  return {
    errors: {
      ...(fields.has('email') ? { email: local.email ?? 'emailInvalid' } : {}),
      ...(fields.has('password') ? { password: local.password ?? 'passwordRejected' } : {}),
    },
    unknown: violations.length === 0 || [...fields].some((field) => field !== 'email' && field !== 'password'),
  }
}

