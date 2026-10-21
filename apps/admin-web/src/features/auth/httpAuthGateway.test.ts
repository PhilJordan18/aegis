import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomRequestId } from '../../api/http'
import type { LoginResponse } from './contract'
import { createHttpAuthGateway } from './httpAuthGateway'
import { signInStateFromResult } from './signInOutcome'
import { adminProfile, problemBody, technicianProfile } from './testFixtures'

const NOW = new Date('2026-09-30T14:30:00Z')
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const SERVER_REQUEST_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const PASSWORD = 'mot-de-passe-de-test'
const TOKEN = 'opaque.jwt.value'

const loginBody = (user = adminProfile): LoginResponse => ({
  accessToken: TOKEN,
  tokenType: 'Bearer',
  expiresIn: 3600,
  expiresAt: '2026-09-30T15:30:00Z',
  user,
})

function json(status: number, body: unknown, headers: Record<string, string> = {}, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type, 'X-Request-Id': SERVER_REQUEST_ID, ...headers } })
}

function problem(status: number, code: string, extra = {}, headers: Record<string, string> = {}): Response {
  return json(status, problemBody(status, code, extra), headers, 'application/problem+json')
}

function gatewayWith(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  const fetchMock = vi.fn(fetchImpl)
  const gateway = createHttpAuthGateway({ fetch: fetchMock as typeof fetch, createRequestId: () => REQUEST_ID, timeoutMs })
  return { gateway, fetchMock }
}

async function signInState(response: Response | Promise<Response>) {
  const { gateway } = gatewayWith(async () => response)
  const result = await gateway.signIn({ email: 'admin@aegis.test', password: PASSWORD })
  return { result, state: signInStateFromResult(result, NOW) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('httpAuthGateway — request shape', () => {
  it('posts exactly the documented login body, same origin, without cookies', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, loginBody()))
    await gateway.signIn({ email: 'admin@aegis.test', password: PASSWORD })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/auth/login')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'admin@aegis.test', password: PASSWORD })
    expect(init?.headers).toEqual({
      Accept: 'application/json, application/problem+json',
      'Content-Type': 'application/json',
      'X-Request-Id': REQUEST_ID,
    })
  })

  it('reads the profile with the bearer token and no body', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, adminProfile))
    const result = await gateway.currentProfile(TOKEN)

    expect(result).toEqual({ kind: 'ok', value: adminProfile, requestId: SERVER_REQUEST_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/auth/me')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'X-Request-Id': REQUEST_ID })
  })

  it('generates RFC 9562 version 4 request ids without crypto.randomUUID', () => {
    expect(randomRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('httpAuthGateway — login outcomes mapped to the existing UI states', () => {
  it('200 ADMIN signs in with the token, its lifetime and the profile', async () => {
    const { state } = await signInState(json(200, loginBody()))
    expect(state).toEqual({ kind: 'signedIn', accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  })

  it('200 TECHNICIAN is the role-not-authorized state, without the token', async () => {
    const { state } = await signInState(json(200, loginBody(technicianProfile)))
    expect(state).toEqual({ kind: 'unauthorizedRole', role: 'TECHNICIAN' })
    expect(JSON.stringify(state)).not.toContain(TOKEN)
  })

  it('200 with an unknown role is refused, never treated as an administrator', async () => {
    const { state } = await signInState(json(200, loginBody({ ...adminProfile, role: 'AUDITOR' as never })))
    expect(state).toEqual({ kind: 'unauthorizedRole', role: null })
  })

  it('401 AUTH_INVALID_CREDENTIALS is the invalid-credentials state', async () => {
    const { state } = await signInState(problem(401, 'AUTH_INVALID_CREDENTIALS'))
    expect(state).toEqual({ kind: 'invalidCredentials' })
  })

  it('429 passes the Retry-After header through to the countdown', async () => {
    const { result, state } = await signInState(problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '55' }))
    expect(result).toMatchObject({ kind: 'httpProblem', status: 429, retryAfter: '55', requestId: SERVER_REQUEST_ID })
    expect(state).toEqual({ kind: 'rateLimited', retryAfterSeconds: 55 })
  })

  it('429 without Retry-After falls back to the one-minute message', async () => {
    const { state } = await signInState(problem(429, 'RATE_LIMITED'))
    expect(state).toEqual({ kind: 'rateLimited', retryAfterSeconds: null })
  })

  it('400 VALIDATION_ERROR keeps the field violations', async () => {
    const violations = [{ field: 'password', code: 'MAX_UTF8_BYTES', message: 'Le mot de passe dépasse 72 octets.' }]
    const { state } = await signInState(problem(400, 'VALIDATION_ERROR', { violations }))
    expect(state).toEqual({ kind: 'validation', violations })
  })

  it('403 at login is not documented (09 §10.2): service error with the trace', async () => {
    const { state } = await signInState(problem(403, 'FORBIDDEN'))
    expect(state).toEqual({ kind: 'serviceError', status: 403, code: 'FORBIDDEN', traceId: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30' })
  })

  it('500 with a problem body is a service error with its traceId', async () => {
    const { state } = await signInState(problem(500, 'INTERNAL_ERROR', { traceId: 'trace-500' }))
    expect(state).toEqual({ kind: 'serviceError', status: 500, code: 'INTERNAL_ERROR', traceId: 'trace-500' })
  })

  it('a 5xx without a problem body (proxy, gateway) is unreachable', async () => {
    const { result, state } = await signInState(new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }))
    expect(result).toMatchObject({ kind: 'httpProblem', status: 502, problem: null })
    expect(state).toEqual({ kind: 'unreachable' })
  })

  it('a malformed problem body is ignored rather than guessed', async () => {
    const { result } = await signInState(json(401, { code: 'AUTH_INVALID_CREDENTIALS' }, {}, 'application/problem+json'))
    expect(result).toMatchObject({ kind: 'httpProblem', status: 401, problem: null })
    expect(signInStateFromResult(result, NOW)).toEqual({ kind: 'serviceError', status: 401, code: null, traceId: SERVER_REQUEST_ID })
  })

  it.each([
    ['a missing token', { ...loginBody(), accessToken: '' }],
    ['a wrong token type', { ...loginBody(), tokenType: 'MAC' }],
    ['no lifetime', { ...loginBody(), expiresIn: 0 }],
    ['an incomplete profile', { ...loginBody(), user: { id: 'x' } }],
  ])('200 with %s is a service error, never a session', async (_label, body) => {
    const { result, state } = await signInState(json(200, body))
    expect(result).toEqual({ kind: 'invalidResponse', status: 200, requestId: SERVER_REQUEST_ID })
    expect(state.kind).toBe('serviceError')
  })

  it('200 with a body that is not JSON is a service error', async () => {
    const { result } = await signInState(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(result).toEqual({ kind: 'invalidResponse', status: 200, requestId: null })
  })

  it('a network failure (offline, CORS, DNS) is unreachable', async () => {
    const { result, state } = await signInState(Promise.reject(new TypeError('Failed to fetch')))
    expect(result).toEqual({ kind: 'network', reason: 'offline' })
    expect(state).toEqual({ kind: 'unreachable' })
  })

  it('the caller aborting returns to idle', async () => {
    const controller = new AbortController()
    const { gateway } = gatewayWith(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const pending = gateway.signIn({ email: 'admin@aegis.test', password: PASSWORD }, controller.signal)
    controller.abort()
    const result = await pending
    expect(result).toEqual({ kind: 'aborted' })
    expect(signInStateFromResult(result, NOW)).toEqual({ kind: 'idle' })
  })

  it('an already aborted signal sends nothing', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, loginBody()))
    const controller = new AbortController()
    controller.abort()
    expect(await gateway.signIn({ email: 'admin@aegis.test', password: PASSWORD }, controller.signal)).toEqual({ kind: 'aborted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('its own timeout reports a network timeout', async () => {
    vi.useFakeTimers()
    const { gateway } = gatewayWith(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
      1000,
    )
    const pending = gateway.signIn({ email: 'admin@aegis.test', password: PASSWORD })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ kind: 'network', reason: 'timeout' })
  })
})

describe('httpAuthGateway — profile outcomes', () => {
  it('passes a 401 AUTH_TOKEN_EXPIRED problem to the caller', async () => {
    const { gateway } = gatewayWith(async () => problem(401, 'AUTH_TOKEN_EXPIRED'))
    expect(await gateway.currentProfile(TOKEN)).toMatchObject({ kind: 'httpProblem', status: 401, problem: { code: 'AUTH_TOKEN_EXPIRED' } })
  })

  it('never puts the token or the password in a result', async () => {
    for (const response of [problem(401, 'AUTH_TOKEN_INVALID'), json(200, { unexpected: true })]) {
      const { gateway } = gatewayWith(async () => response)
      expect(JSON.stringify(await gateway.currentProfile(TOKEN))).not.toContain(TOKEN)
    }
    const { result } = await signInState(problem(401, 'AUTH_INVALID_CREDENTIALS'))
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
  })
})
