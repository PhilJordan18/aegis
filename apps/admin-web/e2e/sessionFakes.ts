import type { Page, Route } from '@playwright/test'
import { routeCatalog, unitId, unitsOf, view, type Unit } from './catalogFakes.ts'

/**
 * A stateful fake of the browser-session part of the API (ADR-016, 09 §10.2, §10.4, §10.5) and of the
 * bearer check of the protected routes. It sets and clears the real `__Secure-aegis_session` cookie, so the
 * browser itself decides what it sends; the fake only reads what arrives. The catalog behind it is the
 * routed fake of the other projects.
 */
export const SESSION_COOKIE = '__Secure-aegis_session'
export const E2E_EMAIL = 'admin@aegis.test'
// Obviously fictitious: the fake accepts only this value and nothing real is ever contacted.
export const E2E_PASSWORD = 'mot-de-passe-fictif-e2e'

/** A second administrator with a catalog of their own: what an account switch must never mix with the first one's. */
export const OTHER_EMAIL = 'autre@aegis.test'
export const OTHER_PASSWORD = 'autre-mot-de-passe-fictif-e2e'
export const OTHER_UNIT_CODE = 'ZZ-900'

const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const ADMIN = {
  id: '75acc15f-fc23-45d9-857d-b543694e4fc2',
  displayName: 'Administrateur Essai',
  email: E2E_EMAIL,
  role: 'ADMIN',
  maximumAccessLevel: 'RESTRICTED',
}
const OTHER = { id: '3d9c7b55-2a1e-4f0b-8c6d-9e8f7a6b5c4d', displayName: 'Administratrice Autre', email: OTHER_EMAIL, role: 'ADMIN', maximumAccessLevel: 'RESTRICTED' }
const ACCOUNTS = [
  { profile: ADMIN, password: E2E_PASSWORD },
  { profile: OTHER, password: OTHER_PASSWORD },
]
const OTHER_UNITS: Unit[] = [
  { id: unitId(900), assetCode: OTHER_UNIT_CODE, name: 'Oscilloscope du second compte', manufacturer: 'Rigol', modelNumber: 'DS1054Z', serialNumber: null, calibrationStatus: 'VALID', dueAt: '2027-02-01T05:00:00Z', reasons: ['UNKNOWN_PHYSICAL_STATE'] },
]
type Profile = typeof ADMIN

export type RefreshMode = 'normal' | 'unreachable' | 'serviceError'

export interface FakeSessionApi {
  /** Calls the fake received, by route. */
  readonly calls: { login: number; refresh: number; revoke: number; protectedReads: number }
  /** Every request carrying the session cookie outside /api/v1/auth/session: must stay empty. */
  readonly cookieLeaks: string[]
  /** Bodies of the login requests, as sent. */
  readonly loginBodies: unknown[]
  /** Origins seen on the three cookie routes. */
  readonly origins: string[]
  refreshMode: RefreshMode
  /** Every protected read answers 403 FORBIDDEN (an authorization answer, never a sign-out). */
  forbidReads: boolean
  /** Every protected read fails like a dead network. */
  readsUnreachable: boolean
  /** The next state-changing command answers 401 AUTH_TOKEN_EXPIRED. */
  rejectNextCommand: boolean
  /** Every archive command received: its path, Idempotency-Key and bearer token. */
  readonly archives: { path: string; idempotencyKey: string | null; token: string }[]
  /** The next `count` revocations fail like a dead network. */
  failRevocations(count: number): void
  /** Holds every refresh until the returned function is called. */
  holdRefresh(): () => void
  /** Server-side revocation of every session: the cookie stays in the browser but is no longer valid. */
  revokeAllSessions(): void
  /** Every access token issued so far stops being accepted (a 401 AUTH_TOKEN_EXPIRED on the next read). */
  expireAccessTokens(): void
  /** Lifetime, in seconds, given to the next access tokens. */
  tokenLifetime: number
}

function problem(status: number, code: string, instance: string) {
  return { type: `https://aegis.local/problems/${code.toLowerCase()}`, title: 'Fictif', status, code, detail: 'Détail serveur fictif, jamais affiché.', instance, traceId: TRACE_ID, timestamp: '2026-11-18T14:30:00Z' }
}

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}, type = 'application/json') =>
  route.fulfill({ status, contentType: type, headers: { 'X-Request-Id': TRACE_ID, ...headers }, body: JSON.stringify(body) })

const problemResponse = (route: Route, status: number, code: string, instance: string, headers: Record<string, string> = {}) =>
  json(route, status, problem(status, code, instance), headers, 'application/problem+json')

const cookieHeader = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/api/v1/auth/session; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`

function cookieValue(header: string | undefined): string | null {
  const match = header?.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  return match ? match.slice(SESSION_COOKIE.length + 1) : null
}

export async function routeFakeSessionApi(page: Pick<Page, 'route'>, allowedOrigin: string): Promise<FakeSessionApi> {
  const sessions = new Map<string, Profile>()
  const accessTokens = new Map<string, Profile>()
  let counter = 0
  let failures = 0
  let gate: Promise<void> | null = null

  const api: FakeSessionApi = {
    calls: { login: 0, refresh: 0, revoke: 0, protectedReads: 0 },
    cookieLeaks: [],
    loginBodies: [],
    origins: [],
    refreshMode: 'normal',
    forbidReads: false,
    readsUnreachable: false,
    rejectNextCommand: false,
    archives: [],
    tokenLifetime: 3600,
    failRevocations(count) {
      failures = count
    },
    holdRefresh() {
      let release: () => void = () => {}
      gate = new Promise<void>((resolve) => (release = resolve))
      return () => {
        release()
        gate = null
      }
    },
    revokeAllSessions() {
      sessions.clear()
    },
    expireAccessTokens() {
      accessTokens.clear()
    },
  }

  function issue(user: Profile): { accessToken: string; tokenType: 'Bearer'; expiresIn: number; expiresAt: string; user: Profile } {
    counter += 1
    const accessToken = `fictive-access-token-${counter}`
    accessTokens.set(accessToken, user)
    return { accessToken, tokenType: 'Bearer', expiresIn: api.tokenLifetime, expiresAt: new Date(Date.now() + api.tokenLifetime * 1000).toISOString(), user }
  }

  // The catalog answers every authorized read; the guard below runs first and falls back to it.
  await routeCatalog(page, 'nominal')

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const path = pathname.replace('/api/v1', '')
    const headers = await request.allHeaders()
    const cookie = cookieValue(headers.cookie)

    if (cookie !== null && !path.startsWith('/auth/session')) api.cookieLeaks.push(`${request.method()} ${path}`)

    if (path === '/auth/login') {
      api.calls.login += 1
      api.origins.push(headers.origin ?? '')
      const body = request.postDataJSON() as { email?: string; password?: string; browserSession?: boolean }
      api.loginBodies.push(body)
      if (body.browserSession === true && headers.origin !== allowedOrigin) return problemResponse(route, 403, 'FORBIDDEN', path)
      const account = ACCOUNTS.find(({ profile, password }) => profile.email === body.email && password === body.password)
      if (!account) return problemResponse(route, 401, 'AUTH_INVALID_CREDENTIALS', path)
      const value = `opaque-session-${counter + 1}-${Math.random().toString(36).slice(2)}`
      sessions.set(value, account.profile)
      return json(route, 200, issue(account.profile), { 'Set-Cookie': cookieHeader(value, 28800) })
    }

    if (path === '/auth/session/refresh') {
      api.calls.refresh += 1
      api.origins.push(headers.origin ?? '')
      if (gate) await gate
      if (headers.origin !== allowedOrigin) return problemResponse(route, 403, 'FORBIDDEN', path)
      if (api.refreshMode === 'unreachable') return route.abort('connectionrefused')
      if (api.refreshMode === 'serviceError') return problemResponse(route, 503, 'INTERNAL_ERROR', path)
      const owner = cookie === null ? undefined : sessions.get(cookie)
      if (!owner) return problemResponse(route, 401, 'AUTH_SESSION_INVALID', path, { 'Set-Cookie': cookieHeader('', 0) })
      return json(route, 200, issue(owner))
    }

    if (path === '/auth/session/revoke') {
      api.calls.revoke += 1
      api.origins.push(headers.origin ?? '')
      if (failures > 0) {
        failures -= 1
        return route.abort('connectionrefused')
      }
      if (cookie !== null) sessions.delete(cookie)
      return route.fulfill({ status: 204, headers: { 'X-Request-Id': TRACE_ID, 'Set-Cookie': cookieHeader('', 0) } })
    }

    // Every other route is protected by the bearer token and never receives the cookie.
    api.calls.protectedReads += 1
    const bearer = headers.authorization?.replace(/^Bearer /, '') ?? ''
    const owner = accessTokens.get(bearer)
    if (!owner) return problemResponse(route, 401, 'AUTH_TOKEN_EXPIRED', path)
    const command = request.method() !== 'GET'
    if (command && api.rejectNextCommand) {
      api.rejectNextCommand = false
      if (/\/archive$/.test(path)) api.archives.push({ path, idempotencyKey: headers['idempotency-key'] ?? null, token: bearer })
      return problemResponse(route, 401, 'AUTH_TOKEN_EXPIRED', path)
    }
    if (!command && api.readsUnreachable) return route.abort('connectionrefused')
    if (!command && api.forbidReads) return problemResponse(route, 403, 'FORBIDDEN', path)
    if (path === '/auth/me') return json(route, 200, owner)

    // The second account has its own catalog; the first one's is the shared routed fake.
    if (owner === OTHER && path.startsWith('/admin/assets')) {
      if (/\/identifiers$/.test(path)) return json(route, 200, [])
      const byId = path.match(/\/admin\/assets\/([^/]+)$/)
      if (byId) {
        const unit = OTHER_UNITS.find((candidate) => candidate.id === byId[1])
        return unit ? json(route, 200, view(unit)) : problemResponse(route, 404, 'RESOURCE_NOT_FOUND', path)
      }
      return json(route, 200, { items: OTHER_UNITS.map(view), page: 0, size: 20, totalItems: OTHER_UNITS.length, totalPages: 1 })
    }

    const archive = path.match(/\/admin\/assets\/([^/]+)\/archive$/)
    if (command && archive) {
      api.archives.push({ path, idempotencyKey: headers['idempotency-key'] ?? null, token: bearer })
      const unit = unitsOf('nominal').find((candidate) => candidate.id === archive[1])
      return unit ? json(route, 200, { ...view(unit), archivedAt: '2026-11-18T14:30:00Z' }) : problemResponse(route, 404, 'RESOURCE_NOT_FOUND', path)
    }
    return route.fallback()
  })

  return api
}

/** Records every path the page shows through the History API and full navigations: never lost by a reload. */
export async function trackPaths(page: Page): Promise<string[]> {
  const paths: string[] = []
  await page.exposeFunction('__recordPath', (path: string) => paths.push(path))
  await page.addInitScript(() => {
    const record = () => void (window as unknown as { __recordPath: (path: string) => void }).__recordPath(location.pathname + location.search)
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history)
      history[method] = (...args: Parameters<History['pushState']>) => {
        original(...args)
        record()
      }
    }
    window.addEventListener('popstate', record)
    record()
  })
  return paths
}
