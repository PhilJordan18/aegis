/**
 * Authentication contract mirrored from docs/cahier-conception/09-contrats-rest.md:
 * §3 conventions, §4.1–4.4 token and minimal profile, §7 problem+json error
 * body, §10.2 POST /auth/login, §10.3 GET /auth/me, §21 stable error codes.
 * The access token is opaque to the client (§4.1, ADR-007).
 */

export type UserRole = 'ADMIN' | 'TECHNICIAN'
export type AccessLevel = 'STANDARD' | 'RESTRICTED'

/** §10.2 request. Unknown fields are rejected by the server (§3). */
export interface LoginRequest {
  readonly email: string
  readonly password: string
}

/** §4.4 minimal profile, returned by login (§10.2) and GET /auth/me (§10.3). */
export interface UserProfile {
  readonly id: string
  readonly displayName: string
  readonly email: string
  readonly role: UserRole
  readonly maximumAccessLevel: AccessLevel
}

/** §10.2 response 200. */
export interface LoginResponse {
  readonly accessToken: string
  readonly tokenType: 'Bearer'
  readonly expiresIn: number
  /** RFC 3339 UTC instant (§3). */
  readonly expiresAt: string
  readonly user: UserProfile
}

/** §7: one field error. Never carries the rejected password or token value. */
export interface ProblemViolation {
  readonly field: string
  readonly code: string
  readonly message: string
}

/** §7 application/problem+json body. */
export interface ProblemResponse {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly code: string
  readonly detail: string
  readonly instance: string
  readonly traceId: string
  readonly timestamp: string
  readonly reasons?: readonly string[]
  readonly violations?: readonly ProblemViolation[]
}

/** §21 codes relevant to entering and leaving a session. */
export const AuthErrorCode = {
  ValidationError: 'VALIDATION_ERROR',
  InvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  TokenInvalid: 'AUTH_TOKEN_INVALID',
  TokenExpired: 'AUTH_TOKEN_EXPIRED',
  Forbidden: 'FORBIDDEN',
  RateLimited: 'RATE_LIMITED',
  InternalError: 'INTERNAL_ERROR',
} as const

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode]
