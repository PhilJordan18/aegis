import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { AuthGateway } from './authGateway'
import { parseLoginResponse, parseUserProfile } from './contractParsers'

/** Production adapter: POST /auth/login (09 §10.2) and GET /auth/me (09 §10.3). */
export function createHttpAuthGateway(options?: HttpClientOptions): AuthGateway {
  const http = createHttpClient(options)
  return {
    signIn({ email, password }, signal) {
      // Only the two documented fields: the server rejects unknown ones (09 §3).
      return http.send({ method: 'POST', path: '/auth/login', body: { email, password }, signal, parse: parseLoginResponse })
    },
    currentProfile(accessToken, signal) {
      return http.send({ method: 'GET', path: '/auth/me', accessToken, signal, parse: parseUserProfile })
    },
  }
}
