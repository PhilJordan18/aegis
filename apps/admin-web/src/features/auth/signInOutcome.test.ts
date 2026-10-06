import { describe, expect, it } from 'vitest'
import type { UserProfile } from './contract'
import { arrivalReasonFromUnauthorized, parseRetryAfterSeconds, signInStateFromResult } from './signInOutcome'
import { adminProfile, httpProblem, loginOk, problemBody, technicianProfile } from './testFixtures'

const NOW = new Date('2026-09-30T14:30:00Z')

describe('signInStateFromResult — successful login', () => {
  it('signs in an administrator and keeps the token for the session store', () => {
    expect(signInStateFromResult(loginOk(adminProfile, 'opaque'))).toEqual({
      kind: 'signedIn',
      accessToken: 'opaque',
      expiresAt: '2026-09-30T15:30:00Z',
      profile: adminProfile,
    })
  })

  it('refuses a technician without exposing the token (U6)', () => {
    const state = signInStateFromResult(loginOk(technicianProfile, 'technician-token'))
    expect(state).toEqual({ kind: 'unauthorizedRole', role: 'TECHNICIAN' })
    expect(JSON.stringify(state)).not.toContain('technician-token')
  })

  it('refuses an unknown role instead of guessing (09 §3)', () => {
    const unknown = { ...adminProfile, role: 'AUDITOR' } as unknown as UserProfile
    expect(signInStateFromResult(loginOk(unknown))).toEqual({ kind: 'unauthorizedRole', role: null })
  })
})

describe('signInStateFromResult — documented login errors (09 §10.2, §21)', () => {
  it('maps 401 AUTH_INVALID_CREDENTIALS', () => {
    expect(signInStateFromResult(httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS')))).toEqual({
      kind: 'invalidCredentials',
    })
  })

  it('maps 429 with Retry-After seconds', () => {
    expect(signInStateFromResult(httpProblem(429, problemBody(429, 'RATE_LIMITED'), '42'), NOW)).toEqual({
      kind: 'rateLimited',
      retryAfterSeconds: 42,
    })
  })

  it('maps 429 without Retry-After or body', () => {
    expect(signInStateFromResult(httpProblem(429, null))).toEqual({ kind: 'rateLimited', retryAfterSeconds: null })
  })

  it('maps 400 VALIDATION_ERROR with its field violations', () => {
    const violations = [{ field: 'email', code: 'INVALID', message: 'Adresse invalide.' }]
    expect(signInStateFromResult(httpProblem(400, problemBody(400, 'VALIDATION_ERROR', { violations })))).toEqual({
      kind: 'validation',
      violations,
    })
  })

  it('maps 400 VALIDATION_ERROR without violations to an empty list', () => {
    expect(signInStateFromResult(httpProblem(400, problemBody(400, 'VALIDATION_ERROR')))).toEqual({
      kind: 'validation',
      violations: [],
    })
  })
})

describe('signInStateFromResult — transport and unexpected answers', () => {
  it.each(['offline', 'timeout', 'notConfigured'] as const)('maps network %s to unreachable', (reason) => {
    expect(signInStateFromResult({ kind: 'network', reason })).toEqual({ kind: 'unreachable' })
  })

  it.each([500, 502, 503, 504])('maps %i without a usable body to unreachable', (status) => {
    expect(signInStateFromResult(httpProblem(status, null))).toEqual({ kind: 'unreachable' })
  })

  it('maps 500 INTERNAL_ERROR with a body to serviceError keeping the traceId', () => {
    expect(signInStateFromResult(httpProblem(500, problemBody(500, 'INTERNAL_ERROR')))).toEqual({
      kind: 'serviceError',
      status: 500,
      code: 'INTERNAL_ERROR',
      traceId: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30',
    })
  })

  it('does not treat a 401 with another code as wrong credentials', () => {
    expect(signInStateFromResult(httpProblem(401, problemBody(401, 'AUTH_TOKEN_INVALID')))).toMatchObject({
      kind: 'serviceError',
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
    })
  })

  it('falls back to the request id when there is no problem body', () => {
    expect(signInStateFromResult(httpProblem(403, null, null, 'req-9'))).toEqual({
      kind: 'serviceError',
      status: 403,
      code: null,
      traceId: 'req-9',
    })
  })

  it('does not treat a 400 with another code as a field validation', () => {
    expect(signInStateFromResult(httpProblem(400, problemBody(400, 'IDEMPOTENCY_KEY_REQUIRED')))).toMatchObject({
      kind: 'serviceError',
    })
  })

  it('returns to idle when the request was aborted', () => {
    expect(signInStateFromResult({ kind: 'aborted' })).toEqual({ kind: 'idle' })
  })
})

describe('parseRetryAfterSeconds', () => {
  it.each([
    [null, null],
    ['', null],
    ['  ', null],
    ['60', 60],
    [' 5 ', 5],
    ['0', 0],
    ['-3', null],
    ['1.5', null],
    ['soon', null],
    ['999999', 86400],
  ])('parses %j as %j', (header, expected) => {
    expect(parseRetryAfterSeconds(header, NOW)).toBe(expected)
  })

  it('parses an HTTP date relative to now', () => {
    expect(parseRetryAfterSeconds('Wed, 30 Sep 2026 14:31:30 GMT', NOW)).toBe(90)
  })

  it('clamps a past HTTP date to zero', () => {
    expect(parseRetryAfterSeconds('Wed, 30 Sep 2026 14:00:00 GMT', NOW)).toBe(0)
  })
})

describe('arrivalReasonFromUnauthorized', () => {
  it('distinguishes expired from invalid tokens (09 §21)', () => {
    expect(arrivalReasonFromUnauthorized(401, 'AUTH_TOKEN_EXPIRED')).toBe('sessionExpired')
    expect(arrivalReasonFromUnauthorized(401, 'AUTH_TOKEN_INVALID')).toBe('sessionInvalid')
  })

  it('treats an unexplained 401 as an invalid session', () => {
    expect(arrivalReasonFromUnauthorized(401, null)).toBe('sessionInvalid')
  })

  it('does not end the session on 403 or other statuses', () => {
    expect(arrivalReasonFromUnauthorized(403, 'FORBIDDEN')).toBeNull()
    expect(arrivalReasonFromUnauthorized(500, 'INTERNAL_ERROR')).toBeNull()
  })
})
