import { ApiRequestError, SessionEndedError } from '../../api/serverState'
import type { AuthGateway, GatewayResult } from './authGateway'
import type { UserProfile } from './contract'
import type { SessionStore } from './session'
import { arrivalReasonFromUnauthorized } from './signInOutcome'

/**
 * Runs one protected call with the in-memory token. A 401 ends the session with
 * the server's reason (09 §4.3, §21; states.md §1), which sends the user back
 * to sign-in. A response for a token that is no longer current never ends the
 * newer session.
 */
export async function authorizedRequest<T>(session: SessionStore, call: (accessToken: string) => Promise<GatewayResult<T>>): Promise<T> {
  const token = session.getAccessToken()
  if (token === null) throw new SessionEndedError()
  const result = await call(token)
  if (result.kind === 'ok') return result.value
  if (result.kind === 'httpProblem' && session.getAccessToken() === token) {
    const reason = arrivalReasonFromUnauthorized(result.status, result.problem?.code ?? null)
    if (reason === 'sessionExpired' || reason === 'sessionInvalid') session.end(reason)
  }
  throw new ApiRequestError(result)
}

/**
 * GET /auth/me (09 §10.3): the server re-reads the account on every protected
 * request (09 §4.1), so this confirms that the session may still act as an
 * administrator. A profile that is no longer ADMIN, or a 403, ends the session
 * as invalid: the Manager never keeps a token it may not use.
 */
export async function fetchCurrentAdminProfile(gateway: AuthGateway, session: SessionStore, signal?: AbortSignal): Promise<UserProfile> {
  const token = session.getAccessToken()
  const stillCurrent = () => token !== null && session.getAccessToken() === token
  let profile: UserProfile
  try {
    profile = await authorizedRequest(session, (accessToken) => gateway.currentProfile(accessToken, signal))
  } catch (error) {
    if (error instanceof ApiRequestError && error.failure.kind === 'httpProblem' && error.failure.status === 403 && stillCurrent()) {
      session.end('sessionInvalid')
    }
    throw error
  }
  if (profile.role !== 'ADMIN') {
    if (stillCurrent()) session.end('sessionInvalid')
    throw new SessionEndedError()
  }
  return profile
}
