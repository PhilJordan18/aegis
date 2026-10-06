import type { ProblemViolation } from './contract'
import { signInCopy } from './signInCopy'

const { proposed } = signInCopy

/** states.md §2: a request still pending after 15 s is abandoned and reported as unreachable. */
export const SIGN_IN_TIMEOUT_MS = 15_000
const MAX_EMAIL_LENGTH = 320
// Feedback only; the server validates and normalises (09 §10.2).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface FieldErrors {
  readonly email?: string
  readonly password?: string
}

/** Client validation (states.md §3 `validation`): no request is sent while this returns errors. */
export function validateSignIn(email: string, password: string): FieldErrors {
  const trimmed = email.trim()
  const emailError =
    trimmed === ''
      ? proposed.emailRequired
      : trimmed.length > MAX_EMAIL_LENGTH
        ? proposed.emailTooLong
        : EMAIL_PATTERN.test(trimmed)
          ? undefined
          : proposed.emailInvalid
  return {
    ...(emailError ? { email: emailError } : {}),
    ...(password === '' ? { password: proposed.passwordRequired } : {}),
  }
}

/**
 * Server 400: messages are chosen by field, never taken from `violations[].message`.
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
      ...(fields.has('email') ? { email: local.email ?? proposed.emailInvalid } : {}),
      ...(fields.has('password') ? { password: local.password ?? proposed.passwordRejected } : {}),
    },
    unknown: violations.length === 0 || [...fields].some((field) => field !== 'email' && field !== 'password'),
  }
}

