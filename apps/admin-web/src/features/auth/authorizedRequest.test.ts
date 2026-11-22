import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, isTransientFailure, SessionEndedError, SessionRestoredError } from '../../api/serverState'
import type { AuthGateway, GatewayFailure, GatewayResult } from './authGateway'
import { unconfiguredAuthGateway } from './authGateway'
import { authorizedCommand, authorizedRequest, fetchCurrentAdminProfile } from './authorizedRequest'
import type { UserProfile } from './contract'
import { createSessionStore, type SessionStore } from './session'
import { adminProfile, loginOk, problemBody, sessionStubs, technicianProfile } from './testFixtures'

function signedIn(token = 'token-a', transport: Parameters<SessionStore['connect']>[0] = sessionStubs) {
  const session = createSessionStore()
  session.connect(transport)
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
  ] as const)('a 401 %s whose renewal is refused ends the session as %s and keeps the email to prefill', async (code, reason) => {
    const session = signedIn()
    await expect(authorizedRequest(session, async () => problem(401, code))).rejects.toBeInstanceOf(ApiRequestError)
    expect(session.getAccessToken()).toBeNull()
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: reason, email: adminProfile.email })
  })

  it('a 401 renews the session once and retries the call once with the new token', async () => {
    const refreshSession = vi.fn(async () => loginOk(adminProfile, 'token-b'))
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    const call = vi.fn(async (token: string) => (token === 'token-a' ? problem(401, 'AUTH_TOKEN_EXPIRED') : ({ kind: 'ok', value: 'done', requestId: null } as const)))

    expect(await authorizedRequest(session, call)).toBe('done')
    expect(call.mock.calls.map(([token]) => token)).toEqual(['token-a', 'token-b'])
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('never loops: a 401 on the retry ends the session without a second refresh', async () => {
    const refreshSession = vi.fn(async () => loginOk(adminProfile, 'token-b'))
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    const call = vi.fn(async () => problem(401, 'AUTH_TOKEN_INVALID'))

    await expect(authorizedRequest(session, call)).rejects.toBeInstanceOf(ApiRequestError)
    expect(call).toHaveBeenCalledTimes(2)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', arrivalReason: 'sessionInvalid' })
  })

  it('concurrent 401s share one refresh and each retries once', async () => {
    const refreshSession = vi.fn(async () => loginOk(adminProfile, 'token-b'))
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    const call = vi.fn(async (token: string) => (token === 'token-a' ? problem(401, 'AUTH_TOKEN_EXPIRED') : ({ kind: 'ok', value: 7, requestId: null } as const)))

    const results = await Promise.all([authorizedRequest(session, call), authorizedRequest(session, call), authorizedRequest(session, call)])
    expect(results).toEqual([7, 7, 7])
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledTimes(6)
  })

  it('reports the refresh failure, and keeps the session, when the server cannot be asked', async () => {
    const session = signedIn('token-a', { ...sessionStubs, refreshSession: async () => ({ kind: 'network', reason: 'offline' }) })
    const error = await authorizedRequest(session, async () => problem(401, 'AUTH_TOKEN_EXPIRED')).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(isTransientFailure(error)).toBe(true)
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('does not refresh for a 403, a 5xx or a network failure', async () => {
    const refreshSession = vi.fn(sessionStubs.refreshSession)
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    await expect(authorizedRequest(session, async () => problem(403, 'FORBIDDEN'))).rejects.toBeInstanceOf(ApiRequestError)
    await expect(authorizedRequest(session, async () => problem(500, 'INTERNAL_ERROR'))).rejects.toBeInstanceOf(ApiRequestError)
    await expect(authorizedRequest(session, async () => ({ kind: 'network', reason: 'offline' }))).rejects.toBeInstanceOf(ApiRequestError)
    expect(refreshSession).not.toHaveBeenCalled()
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('a late 401 for a previous token never ends the newer session: the call is retried with the newer token', async () => {
    const session = signedIn('old')
    const call = vi.fn(async (token: string) => {
      if (token === 'old') {
        session.start({ accessToken: 'new', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
        return problem(401, 'AUTH_TOKEN_EXPIRED')
      }
      return { kind: 'ok', value: 'fresh', requestId: null } as const
    })
    expect(await authorizedRequest(session, call)).toBe('fresh')
    expect(session.getAccessToken()).toBe('new')
  })

  it('refuses to call without a session', async () => {
    const call = vi.fn()
    await expect(authorizedRequest(createSessionStore(), call)).rejects.toBeInstanceOf(SessionEndedError)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('authorizedCommand: a command is never replayed', () => {
  it('sends the in-memory token and returns the value', async () => {
    const session = signedIn('token-a')
    const call = vi.fn(async (token: string) => ({ kind: 'ok', value: token, requestId: null }) as const)
    expect(await authorizedCommand(session, call)).toBe('token-a')
  })

  it('restores the session on a 401 but does not send the command again: the user re-submits', async () => {
    const refreshSession = vi.fn(async () => loginOk(adminProfile, 'token-b'))
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    const call = vi.fn(async () => problem(401, 'AUTH_TOKEN_EXPIRED'))

    await expect(authorizedCommand(session, call)).rejects.toBeInstanceOf(SessionRestoredError)
    expect(call).toHaveBeenCalledTimes(1)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(session.getAccessToken()).toBe('token-b')
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('ends the session when the renewal is refused, without sending the command again', async () => {
    const session = signedIn()
    const call = vi.fn(async () => problem(401, 'AUTH_TOKEN_INVALID'))
    await expect(authorizedCommand(session, call)).rejects.toBeInstanceOf(ApiRequestError)
    expect(call).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', arrivalReason: 'sessionInvalid' })
  })

  it('keeps the session when the server cannot be asked, and reports a transient failure', async () => {
    const session = signedIn('token-a', { ...sessionStubs, refreshSession: async () => ({ kind: 'network', reason: 'timeout' }) })
    const error = await authorizedCommand(session, async () => problem(401, 'AUTH_TOKEN_EXPIRED')).catch((caught: unknown) => caught)
    expect(isTransientFailure(error)).toBe(true)
    expect(session.getSnapshot().status).toBe('authenticated')
  })

  it('does not renew for a 403, a 409 or a 5xx: those answers are final for the command', async () => {
    const refreshSession = vi.fn(sessionStubs.refreshSession)
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    for (const [status, code] of [[403, 'FORBIDDEN'], [409, 'ASSET_HAS_OPEN_LOAN'], [503, 'INTERNAL_ERROR']] as const) {
      const call = vi.fn(async () => problem(status, code))
      await expect(authorizedCommand(session, call)).rejects.toBeInstanceOf(ApiRequestError)
      expect(call).toHaveBeenCalledTimes(1)
    }
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('a read and a command that fail together share one refresh, and only the read is retried', async () => {
    const refreshSession = vi.fn(async () => loginOk(adminProfile, 'token-b'))
    const session = signedIn('token-a', { ...sessionStubs, refreshSession })
    const read = vi.fn(async (token: string) => (token === 'token-a' ? problem(401, 'AUTH_TOKEN_EXPIRED') : ({ kind: 'ok', value: 'list', requestId: null } as const)))
    const command = vi.fn(async () => problem(401, 'AUTH_TOKEN_EXPIRED'))

    const [readResult, commandResult] = await Promise.allSettled([authorizedRequest(session, read), authorizedCommand(session, command)])
    expect(readResult).toEqual({ status: 'fulfilled', value: 'list' })
    expect(commandResult.status === 'rejected' && commandResult.reason).toBeInstanceOf(SessionRestoredError)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(command).toHaveBeenCalledTimes(1)
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

  it('keeps the session on a 403: an authorization answer, never a sign-out', async () => {
    const session = signedIn()
    const error = await fetchCurrentAdminProfile(profileGateway(problem(403, 'FORBIDDEN')), session).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(session.getSnapshot()).toMatchObject({ status: 'authenticated', profile: adminProfile })
    expect(session.getAccessToken()).toBe('token-a')
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
