import type { Page, Route } from '@playwright/test'
import { routeCatalog } from './catalogFakes.ts'

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

const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const ADMIN = {
  id: '75acc15f-fc23-45d9-857d-b543694e4fc2',
  displayName: 'Administrateur Essai',
  email: E2E_EMAIL,
  role: 'ADMIN',
  maximumAccessLevel: 'RESTRICTED',
}

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

export async function routeFakeSessionApi(page: Page, allowedOrigin: string): Promise<FakeSessionApi> {
  const sessions = new Set<string>()
  const accessTokens = new Set<string>()
  let counter = 0
  let failures = 0
  let gate: Promise<void> | null = null

  const api: FakeSessionApi = {
    calls: { login: 0, refresh: 0, revoke: 0, protectedReads: 0 },
    cookieLeaks: [],
    loginBodies: [],
    origins: [],
    refreshMode: 'normal',
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

  function issue(): { accessToken: string; tokenType: 'Bearer'; expiresIn: number; expiresAt: string; user: typeof ADMIN } {
    counter += 1
    const accessToken = `fictive-access-token-${counter}`
    accessTokens.add(accessToken)
    return { accessToken, tokenType: 'Bearer', expiresIn: api.tokenLifetime, expiresAt: new Date(Date.now() + api.tokenLifetime * 1000).toISOString(), user: ADMIN }
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
      if (body.email !== E2E_EMAIL || body.password !== E2E_PASSWORD) return problemResponse(route, 401, 'AUTH_INVALID_CREDENTIALS', path)
      const value = `opaque-session-${counter + 1}-${Math.random().toString(36).slice(2)}`
      sessions.add(value)
      return json(route, 200, issue(), { 'Set-Cookie': cookieHeader(value, 28800) })
    }

    if (path === '/auth/session/refresh') {
      api.calls.refresh += 1
      api.origins.push(headers.origin ?? '')
      if (gate) await gate
      if (headers.origin !== allowedOrigin) return problemResponse(route, 403, 'FORBIDDEN', path)
      if (api.refreshMode === 'unreachable') return route.abort('connectionrefused')
      if (api.refreshMode === 'serviceError') return problemResponse(route, 503, 'INTERNAL_ERROR', path)
      if (cookie === null || !sessions.has(cookie)) return problemResponse(route, 401, 'AUTH_SESSION_INVALID', path, { 'Set-Cookie': cookieHeader('', 0) })
      return json(route, 200, issue())
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
    if (!accessTokens.has(bearer)) return problemResponse(route, 401, 'AUTH_TOKEN_EXPIRED', path)
    if (path === '/auth/me') return json(route, 200, ADMIN)
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
