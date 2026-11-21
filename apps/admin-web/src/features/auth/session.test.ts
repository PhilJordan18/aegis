import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayResult } from './authGateway'
import type { LoginResponse } from './contract'
import { createSessionStore, type SessionTransport } from './session'
import { adminProfile, httpProblem, loginOk, problemBody, technicianProfile } from './testFixtures'

const TOKEN = 'secret-test-token-value'

function refused(): GatewayResult<LoginResponse> {
  return httpProblem(401, problemBody(401, 'AUTH_SESSION_INVALID'))
}

/** Scripted answers of the two session routes; an exhausted script answers like a dead network. */
function transport({ refresh = [], revoke = [] }: { refresh?: GatewayResult<LoginResponse>[]; revoke?: GatewayResult<true>[] } = {}) {
  const dead = { kind: 'network', reason: 'offline' } as const
  const refreshSession = vi.fn(async () => refresh.shift() ?? dead)
  const revokeSession = vi.fn(async () => revoke.shift() ?? dead)
  return { transport: { refreshSession, revokeSession } satisfies SessionTransport, refreshSession, revokeSession }
}

const revoked: GatewayResult<true> = { kind: 'ok', value: true, requestId: null }

describe('createSessionStore', () => {
  const writes: string[] = []

  beforeEach(() => {
    writes.length = 0
    localStorage.clear()
    sessionStorage.clear()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string) {
      writes.push(`storage:${key}`)
    })
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
      writes.push(`cookie:${value}`)
      cookie?.set?.call(document, value)
    })
    vi.stubGlobal('indexedDB', {
      open: () => {
        writes.push('indexedDB')
        throw new Error('IndexedDB must not be used')
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the token in memory only, through the whole lifecycle', async () => {
    const store = createSessionStore()
    store.connect(transport({ refresh: [loginOk(adminProfile, 'restored-token')], revoke: [revoked] }).transport)
    await store.restore()
    expect(store.getAccessToken()).toBe('restored-token')
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    expect(store.getAccessToken()).toBe(TOKEN)
    store.end('sessionExpired')
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    await store.signOut()
    expect(store.getAccessToken()).toBeNull()

    expect(writes).toEqual([])
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('never exposes the token in the React snapshot', () => {
    const store = createSessionStore()
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    expect(store.getSnapshot()).toEqual({ status: 'authenticated', profile: adminProfile, expiresAt: '2026-09-30T15:30:00Z', signOut: 'idle' })
    expect(JSON.stringify(store.getSnapshot())).not.toContain(TOKEN)
  })

  it('refuses to keep a non-administrator session', () => {
    const store = createSessionStore()
    expect(() => store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: technicianProfile })).toThrow()
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })
  })

  it('drops the token and records why the session ended', () => {
    const store = createSessionStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    store.end('sessionInvalid')
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionInvalid', email: adminProfile.email })
    store.acknowledgeArrival()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('accepts an explicit email to prefill after a session ends', () => {
    const store = createSessionStore()
    store.end('sessionExpired', 'admin@aegis.demo')
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionExpired', email: 'admin@aegis.demo' })
  })

  describe('expiry (09 §4.1, §10.4: one refresh, then the session ends)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('ends the session as expired once the token lifetime has elapsed and the one refresh is refused, keeping the email', async () => {
      const store = createSessionStore()
      store.connect(transport({ refresh: [refused()] }).transport)
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
      vi.advanceTimersByTime(3600 * 1000 - 1)
      expect(store.getSnapshot().status).toBe('authenticated')
      await vi.advanceTimersByTimeAsync(1)
      expect(store.getAccessToken()).toBeNull()
      expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionExpired', email: adminProfile.email })
    })

    it('ignores the browser clock: expiresAt in the past does not end a fresh session', () => {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const store = createSessionStore()
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
      vi.advanceTimersByTime(60_000)
      expect(store.getSnapshot().status).toBe('authenticated')
    })

    it('cancels the expiry of a session that ended earlier or was replaced', async () => {
      const store = createSessionStore()
      const { transport: stub, refreshSession } = transport({ refresh: [refused()], revoke: [revoked] })
      store.connect(stub)
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      store.end('sessionInvalid')
      store.acknowledgeArrival()
      vi.advanceTimersByTime(120_000)
      expect(refreshSession).not.toHaveBeenCalled()
      expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })

      // A signed-out session stops its timer too; the single refresh expected at the end belongs to the last session.
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      await store.signOut()
      vi.advanceTimersByTime(120_000)
      expect(refreshSession).not.toHaveBeenCalled()
      expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })

      store.start({ accessToken: 'first', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      vi.advanceTimersByTime(30_000)
      store.start({ accessToken: 'second', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      vi.advanceTimersByTime(45_000)
      expect(store.getAccessToken()).toBe('second')
      await vi.advanceTimersByTimeAsync(15_000)
      expect(store.getAccessToken()).toBeNull()
      expect(refreshSession).toHaveBeenCalledTimes(1)
    })

    it('refuses a session without a positive lifetime', () => {
      const store = createSessionStore()
      for (const expiresIn of [0, -1, Number.NaN]) {
        expect(() => store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn, profile: adminProfile })).toThrow()
      }
      expect(store.getAccessToken()).toBeNull()
    })
  })

  it('keeps snapshots stable between changes for useSyncExternalStore', () => {
    const store = createSessionStore()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    store.acknowledgeArrival()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
})

describe('createSessionStore — restoration (ADR-016, 09 §10.4)', () => {
  it('shows restoring until the refresh answers, then starts the session from the answer', async () => {
    const store = createSessionStore()
    let answer: (value: GatewayResult<LoginResponse>) => void = () => {}
    const refreshSession = vi.fn(() => new Promise<GatewayResult<LoginResponse>>((resolve) => (answer = resolve)))
    store.connect({ refreshSession, revokeSession: vi.fn() })

    const restoring = store.restore()
    expect(store.getSnapshot()).toEqual({ status: 'restoring' })
    expect(store.getAccessToken()).toBeNull()

    answer(loginOk(adminProfile, 'restored'))
    await restoring
    expect(store.getSnapshot()).toEqual({ status: 'authenticated', profile: adminProfile, expiresAt: '2026-09-30T15:30:00Z', signOut: 'idle' })
    expect(store.getAccessToken()).toBe('restored')
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('leaves the visitor anonymous, without an arrival notice, on a 401', async () => {
    const store = createSessionStore()
    store.connect(transport({ refresh: [refused()] }).transport)
    await store.restore()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })
  })

  it('does not restore a technician: the answer is dropped and the cookie revoked best-effort', async () => {
    const store = createSessionStore()
    const { transport: stub, revokeSession } = transport({ refresh: [loginOk(technicianProfile)], revoke: [revoked] })
    store.connect(stub)
    await store.restore()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })
    expect(store.getAccessToken()).toBeNull()
    expect(revokeSession).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a network failure', { kind: 'network', reason: 'offline' } as const, 'unreachable', null],
    ['a timeout', { kind: 'network', reason: 'timeout' } as const, 'unreachable', null],
    ['a 5xx without problem body', httpProblem(502, null), 'unreachable', null],
    ['a 503 problem', httpProblem(503, problemBody(503, 'INTERNAL_ERROR')), 'serviceError', problemBody(503, 'INTERNAL_ERROR').traceId],
    ['a 403 (origin not allowed)', httpProblem(403, problemBody(403, 'FORBIDDEN')), 'forbidden', problemBody(403, 'FORBIDDEN').traceId],
    ['a body that is not the contract', { kind: 'invalidResponse', status: 200, requestId: 'req-9' } as const, 'serviceError', 'req-9'],
  ] as const)('is an honest restoreFailed state, never a silent sign-out, on %s', async (_name, failure, expected, traceId) => {
    const store = createSessionStore()
    store.connect(transport({ refresh: [failure] }).transport)
    await store.restore()
    expect(store.getSnapshot()).toEqual({ status: 'restoreFailed', failure: expected, traceId })
    expect(store.getAccessToken()).toBeNull()
  })

  it('retries from restoreFailed through restore(), passing through restoring again', async () => {
    const store = createSessionStore()
    const { transport: stub, refreshSession } = transport({ refresh: [{ kind: 'network', reason: 'offline' }, loginOk(adminProfile, 'second-try')] })
    store.connect(stub)
    await store.restore()
    expect(store.getSnapshot().status).toBe('restoreFailed')
    const statuses: string[] = []
    store.subscribe(() => statuses.push(store.getSnapshot().status))
    await store.restore()
    expect(statuses).toEqual(['restoring', 'authenticated'])
    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('never restores over an open session', async () => {
    const store = createSessionStore()
    const { transport: stub, refreshSession } = transport()
    store.connect(stub)
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    await store.restore()
    expect(refreshSession).not.toHaveBeenCalled()
    expect(store.getAccessToken()).toBe(TOKEN)
  })

  it('discards a refresh that a sign-in overtook, so a late 401 cannot sign the user out', async () => {
    const store = createSessionStore()
    let answer: (value: GatewayResult<LoginResponse>) => void = () => {}
    store.connect({ refreshSession: () => new Promise((resolve) => (answer = resolve)), revokeSession: vi.fn() })
    const restoring = store.restore()
    store.start({ accessToken: 'from-the-form', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    answer(refused())
    await restoring
    expect(store.getSnapshot().status).toBe('authenticated')
    expect(store.getAccessToken()).toBe('from-the-form')
  })

  it('is unreachable, not signed out, while no transport is connected', async () => {
    const store = createSessionStore()
    await store.restore()
    expect(store.getSnapshot()).toEqual({ status: 'restoreFailed', failure: 'unreachable', traceId: null })
  })
})

describe('createSessionStore — renewal (single flight)', () => {
  const start = (store: ReturnType<typeof createSessionStore>, token = 'old') =>
    store.start({ accessToken: token, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })

  it('shares one refresh between concurrent 401s and renews the token for all of them', async () => {
    const store = createSessionStore()
    const { transport: stub, refreshSession } = transport({ refresh: [loginOk(adminProfile, 'new')] })
    store.connect(stub)
    start(store)
    const outcomes = await Promise.all([store.renew('old', 'sessionExpired'), store.renew('old', 'sessionInvalid'), store.renew('old', 'sessionExpired')])
    expect(outcomes).toEqual([{ kind: 'renewed' }, { kind: 'renewed' }, { kind: 'renewed' }])
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(store.getAccessToken()).toBe('new')
  })

  it('a late 401 for a token that was already replaced asks nothing and reports renewed', async () => {
    const store = createSessionStore()
    const { transport: stub, refreshSession } = transport()
    store.connect(stub)
    start(store, 'new')
    expect(await store.renew('old', 'sessionExpired')).toEqual({ kind: 'renewed' })
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('ends the session with the 401 reason when the server refuses the renewal', async () => {
    const store = createSessionStore()
    store.connect(transport({ refresh: [refused()] }).transport)
    start(store)
    expect(await store.renew('old', 'sessionInvalid')).toEqual({ kind: 'ended' })
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionInvalid', email: adminProfile.email })
  })

  it('keeps the session when the server could not be asked, and returns the failure', async () => {
    const store = createSessionStore()
    store.connect(transport({ refresh: [{ kind: 'network', reason: 'offline' }] }).transport)
    start(store)
    expect(await store.renew('old', 'sessionExpired')).toEqual({ kind: 'failed', failure: { kind: 'network', reason: 'offline' } })
    expect(store.getSnapshot().status).toBe('authenticated')
  })

  it('does not apply a renewal to a session that signed out in the meantime', async () => {
    const store = createSessionStore()
    let answer: (value: GatewayResult<LoginResponse>) => void = () => {}
    store.connect({ refreshSession: () => new Promise((resolve) => (answer = resolve)), revokeSession: async () => revoked })
    start(store)
    const renewing = store.renew('old', 'sessionExpired')
    await store.signOut()
    answer(loginOk(adminProfile, 'new'))
    expect(await renewing).toEqual({ kind: 'ended' })
    expect(store.getAccessToken()).toBeNull()
  })

  describe('at token expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('renews once and keeps going, with a new timer from the refreshed lifetime', async () => {
      const store = createSessionStore()
      const base = loginOk(adminProfile, 'renewed')
      const refreshed: GatewayResult<LoginResponse> = base.kind === 'ok' ? { ...base, value: { ...base.value, expiresIn: 600 } } : base
      const { transport: stub, refreshSession } = transport({ refresh: [refreshed, refused()] })
      store.connect(stub)
      start(store)
      await vi.advanceTimersByTimeAsync(3600 * 1000)
      expect(store.getAccessToken()).toBe('renewed')
      expect(refreshSession).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(599 * 1000)
      expect(refreshSession).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(refreshSession).toHaveBeenCalledTimes(2)
      expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionExpired', email: adminProfile.email })
    })

    it('keeps the session and what the user sees when the server cannot be reached at expiry', async () => {
      const store = createSessionStore()
      const { transport: stub, refreshSession } = transport({ refresh: [{ kind: 'network', reason: 'timeout' }, loginOk(adminProfile, 'back')] })
      store.connect(stub)
      start(store)
      await vi.advanceTimersByTimeAsync(3600 * 1000)
      expect(refreshSession).toHaveBeenCalledTimes(1)
      expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', profile: adminProfile })
      // The next protected request will get a 401 and ask again: the failure is recoverable.
      expect(await store.renew('old', 'sessionExpired')).toEqual({ kind: 'renewed' })
      expect(store.getAccessToken()).toBe('back')
    })
  })
})

describe('createSessionStore — explicit sign-out (ADR-016, 09 §10.5)', () => {
  const start = (store: ReturnType<typeof createSessionStore>) =>
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })

  it('revokes on the server first and drops the token only once it confirmed', async () => {
    const store = createSessionStore()
    let confirm: (value: GatewayResult<true>) => void = () => {}
    store.connect({ refreshSession: vi.fn(), revokeSession: () => new Promise((resolve) => (confirm = resolve)) })
    start(store)

    const signingOut = store.signOut()
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', signOut: 'pending' })
    expect(store.getAccessToken()).toBe(TOKEN)

    confirm(revoked)
    expect(await signingOut).toBe(true)
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })
  })

  it.each([
    ['a network failure', { kind: 'network', reason: 'offline' } as const],
    ['a 403 (origin refused)', httpProblem(403, problemBody(403, 'FORBIDDEN')) as GatewayResult<true>],
    ['a 503', httpProblem(503, problemBody(503, 'INTERNAL_ERROR')) as GatewayResult<true>],
  ])('keeps the session open, with the error, on %s: a reload would restore it', async (_name, failure) => {
    const store = createSessionStore()
    store.connect(transport({ revoke: [failure, revoked] }).transport)
    start(store)

    expect(await store.signOut()).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', signOut: 'failed' })
    expect(store.getAccessToken()).toBe(TOKEN)

    expect(await store.signOut()).toBe(true)
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })
  })

  it('ignores a second sign-out while one is pending', async () => {
    const store = createSessionStore()
    const { transport: stub, revokeSession } = transport({ revoke: [revoked] })
    store.connect(stub)
    start(store)
    const first = store.signOut()
    expect(await store.signOut()).toBe(false)
    await first
    expect(revokeSession).toHaveBeenCalledTimes(1)
  })

  it('shows the signed-out arrival from an anonymous store (design-review preview)', async () => {
    const store = createSessionStore()
    expect(await store.signOut()).toBe(true)
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })
  })
})
