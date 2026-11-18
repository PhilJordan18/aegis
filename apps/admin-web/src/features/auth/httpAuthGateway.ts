import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { AuthGateway } from './authGateway'
import type { BrowserLoginRequest } from './contract'
import { parseLoginResponse, parseUserProfile } from './contractParsers'

/**
 * Production adapter: POST /auth/login (09 §10.2), GET /auth/me (09 §10.3) and the browser session
 * routes of ADR-016 (09 §10.4, §10.5). Only those three session calls send the cookie
 * (`same-origin`); GET /auth/me and every other route stay on the bearer token alone.
 */
export function createHttpAuthGateway(options?: HttpClientOptions): AuthGateway {
  const http = createHttpClient(options)
  return {
    signIn({ email, password }, signal) {
      // Exactly the three documented fields: the server rejects unknown ones (09 §3).
      const body: BrowserLoginRequest = { email, password, browserSession: true }
      return http.send({ method: 'POST', path: '/auth/login', body, credentials: 'same-origin', signal, parse: parseLoginResponse })
    },
    currentProfile(accessToken, signal) {
      return http.send({ method: 'GET', path: '/auth/me', accessToken, signal, parse: parseUserProfile })
    },
    refreshSession(signal) {
      return http.send({ method: 'POST', path: '/auth/session/refresh', credentials: 'same-origin', signal, parse: parseLoginResponse })
    },
    revokeSession(signal) {
      return http.send({ method: 'POST', path: '/auth/session/revoke', credentials: 'same-origin', signal, parse: () => true as const })
    },
  }
}
