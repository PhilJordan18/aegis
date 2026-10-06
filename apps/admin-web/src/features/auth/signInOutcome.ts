import type { GatewayResult } from './authGateway'
import { AuthErrorCode, type LoginResponse, type ProblemViolation, type UserProfile, type UserRole } from './contract'

/** UI states of the sign-in form (sections.md §3, U6). */
export type SignInState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'invalidCredentials' }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'validation'; readonly violations: readonly ProblemViolation[] }
  /**
   * The account authenticated but is not an administrator. The caller must drop
   * the token immediately and load no data (U6). `role` is null when the server
   * sent a role this client does not know (09 §3: unknown enum is unavailable).
   */
  | { readonly kind: 'unauthorizedRole'; readonly role: UserRole | null }
  /**
   * The server answered, but not with a documented sign-in outcome (5xx with a
   * problem body, 403, unexpected code). Keeps the trace for support.
   */
  | { readonly kind: 'serviceError'; readonly status: number; readonly code: string | null; readonly traceId: string | null }
  | { readonly kind: 'signedIn'; readonly accessToken: string; readonly expiresAt: string; readonly profile: UserProfile }

export type SignInStateKind = SignInState['kind']

/** Why the user lands on the sign-in page after a session ended. */
export type SignInArrivalReason = 'sessionExpired' | 'sessionInvalid' | 'signedOut'

const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60

/**
 * Parses a `Retry-After` header (RFC 9110 §10.2.3): delay-seconds or HTTP date.
 * Returns null when absent or unusable.
 */
export function parseRetryAfterSeconds(header: string | null, now: Date = new Date()): number | null {
  if (header === null) return null
  const value = header.trim()
  if (value === '') return null
  if (/^\d+$/.test(value)) {
    return Math.min(Number.parseInt(value, 10), MAX_RETRY_AFTER_SECONDS)
  }
  // An HTTP date always names its day or month; Date.parse alone would accept "-3" or "1.5".
  if (!/[A-Za-z]{3}/.test(value)) return null
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.min(Math.max(0, Math.ceil((date - now.getTime()) / 1000)), MAX_RETRY_AFTER_SECONDS)
}

/** Maps one gateway sign-in result to the next UI state. Pure. */
export function signInStateFromResult(result: GatewayResult<LoginResponse>, now: Date = new Date()): SignInState {
  switch (result.kind) {
    case 'ok': {
      const { user, accessToken, expiresAt } = result.value
      if (user.role === 'ADMIN') return { kind: 'signedIn', accessToken, expiresAt, profile: user }
      return { kind: 'unauthorizedRole', role: user.role === 'TECHNICIAN' ? 'TECHNICIAN' : null }
    }
    case 'aborted':
      return { kind: 'idle' }
    case 'network':
      return { kind: 'unreachable' }
    case 'httpProblem': {
      const { status, problem } = result
      const code = problem?.code ?? null
      if (status === 429) {
        return { kind: 'rateLimited', retryAfterSeconds: parseRetryAfterSeconds(result.retryAfter, now) }
      }
      if (status === 401 && code === AuthErrorCode.InvalidCredentials) return { kind: 'invalidCredentials' }
      if (status === 400 && code === AuthErrorCode.ValidationError) {
        return { kind: 'validation', violations: problem?.violations ?? [] }
      }
      if (status >= 500 && problem === null) return { kind: 'unreachable' }
      return { kind: 'serviceError', status, code, traceId: problem?.traceId ?? result.requestId }
    }
  }
}

/**
 * Arrival reason after a protected request failed with 401 (09 §4.3, §21).
 * Returns null for any other status: 403 is an authorization failure, not the end of a session.
 */
export function arrivalReasonFromUnauthorized(status: number, code: string | null): SignInArrivalReason | null {
  if (status !== 401) return null
  return code === AuthErrorCode.TokenExpired ? 'sessionExpired' : 'sessionInvalid'
}
