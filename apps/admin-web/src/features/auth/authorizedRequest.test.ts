import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, isTransientFailure, SessionEndedError } from '../../api/serverState'
import type { AuthGateway, GatewayFailure, GatewayResult } from './authGateway'
import { unconfiguredAuthGateway } from './authGateway'
import { authorizedRequest, fetchCurrentAdminProfile } from './authorizedRequest'
import type { UserProfile } from './contract'
import { createSessionStore } from './session'
import { adminProfile, problemBody, technicianProfile } from './testFixtures'

function signedIn(token = 'token-a') {
  const session = createSessionStore()
  session.start({ accessToken: token, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  return session
}

function problem(status: number, code: string): GatewayFailure {
  return { kind: 'httpProblem', status, problem: problemBody(status, code), retryAfter: null, requestId: 'req' }
}

function profileGateway(result: GatewayResult<UserProfile>): AuthGateway {
  return { ...unconfiguredAuthGateway, currentProfile: vi.fn(async () => result) }
}

describe('authorizedRequest', () => {
  it('sends the in-memory token and returns the value', async () => {
    const session = signedIn('token-a')
    const call = vi.fn(async (token: string) => ({ kind: 'ok', value: token.length, requestId: null }) as const)
    expect(await authorizedRequest(session, call)).toBe(7)
    expect(call).toHaveBeenCalledWith('token-a')
  })

  it.each([
    ['AUTH_TOKEN_EXPIRED', 'sessionExpired'],
    ['AUTH_TOKEN_INVALID', 'sessionInvalid'],
  ] as const)('a 401 %s ends the session as %s and keeps the email to prefill', async (code, reason) => {
    const session = signedIn()
    await expect(authorizedRequest(session, async () => problem(401, code))).rejects.toBeInstanceOf(ApiRequestError)
    expect(session.getAccessToken()).toBeNull()
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: reason, email: adminProfile.email })
  })

  it('a 403 or a 5xx does not end the session', async () => {
    const session = signedIn()
    await expect(authorizedRequest(session, async () => problem(403, 'FORBIDDEN'))).rejects.toBeInstanceOf(ApiRequestError)
    await expect(authorizedRequest(session, async () => problem(500, 'INTERNAL_ERROR'))).rejects.toBeInstanceOf(ApiRequestError)
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('a late 401 for a previous token never ends the newer session', async () => {
    const session = signedIn('old')
    const pending = authorizedRequest(session, async () => {
      session.start({ accessToken: 'new', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
      return problem(401, 'AUTH_TOKEN_EXPIRED')
    })
    await expect(pending).rejects.toBeInstanceOf(ApiRequestError)
    expect(session.getAccessToken()).toBe('new')
  })

  it('refuses to call without a session', async () => {
    const call = vi.fn()
    await expect(authorizedRequest(createSessionStore(), call)).rejects.toBeInstanceOf(SessionEndedError)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('fetchCurrentAdminProfile', () => {
  it('returns the server profile of an administrator', async () => {
    const session = signedIn()
    const renamed = { ...adminProfile, displayName: 'Nom à jour' }
    expect(await fetchCurrentAdminProfile(profileGateway({ kind: 'ok', value: renamed, requestId: null }), session)).toEqual(renamed)
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('ends the session as invalid when the account is no longer an administrator', async () => {
    const session = signedIn()
    const gateway = profileGateway({ kind: 'ok', value: technicianProfile, requestId: null })
    await expect(fetchCurrentAdminProfile(gateway, session)).rejects.toBeInstanceOf(SessionEndedError)
    expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', arrivalReason: 'sessionInvalid' })
  })

  it('ends the session as invalid on a 403', async () => {
    const session = signedIn()
    await expect(fetchCurrentAdminProfile(profileGateway(problem(403, 'FORBIDDEN')), session)).rejects.toBeInstanceOf(ApiRequestError)
    expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', arrivalReason: 'sessionInvalid' })
  })

  it('keeps the session through a network failure, which is retried', async () => {
    const session = signedIn()
    const error = await fetchCurrentAdminProfile(profileGateway({ kind: 'network', reason: 'offline' }), session).catch((caught: unknown) => caught)
    expect(isTransientFailure(error)).toBe(true)
    expect(session.getSnapshot().status).toBe('authenticated')
  })
})

describe('isTransientFailure', () => {
  it('retries transport failures and 5xx only', () => {
    expect(isTransientFailure(new ApiRequestError({ kind: 'network', reason: 'timeout' }))).toBe(true)
    expect(isTransientFailure(new ApiRequestError(problem(503, 'INTERNAL_ERROR')))).toBe(true)
    expect(isTransientFailure(new ApiRequestError(problem(401, 'AUTH_TOKEN_EXPIRED')))).toBe(false)
    expect(isTransientFailure(new ApiRequestError(problem(429, 'RATE_LIMITED')))).toBe(false)
    expect(isTransientFailure(new ApiRequestError({ kind: 'aborted' }))).toBe(false)
    expect(isTransientFailure(new SessionEndedError())).toBe(false)
  })
})
