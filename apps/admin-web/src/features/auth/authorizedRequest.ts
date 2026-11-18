import { ApiRequestError, SessionEndedError } from '../../api/serverState'
import type { AuthGateway, GatewayResult } from './authGateway'
import type { UserProfile } from './contract'
import type { SessionStore } from './session'
import { arrivalReasonFromUnauthorized } from './signInOutcome'

/**
 * Runs one protected call with the in-memory token. A 401 (09 §4.3, §21; states.md §1) first asks the
 * session store for one renewal (ADR-016, 09 §10.4): concurrent 401s share a single refresh, and the call is
 * retried exactly once with the new token. A second 401, or a refused renewal, ends the session with the
 * server's reason and sends the user back to sign-in; it never loops. A 401 means the request was not
 * processed, so the retry cannot repeat a transition (and its idempotency key is reused anyway). A response
 * for a token that is no longer current never ends the newer session.
 */
export async function authorizedRequest<T>(session: SessionStore, call: (accessToken: string) => Promise<GatewayResult<T>>): Promise<T> {
  const token = session.getAccessToken()
  if (token === null) throw new SessionEndedError()
  const result = await call(token)
  if (result.kind === 'ok') return result.value
  if (result.kind !== 'httpProblem') throw new ApiRequestError(result)

  const reason = arrivalReasonFromUnauthorized(result.status, result.problem?.code ?? null)
  if (reason === 'sessionExpired' || reason === 'sessionInvalid') {
    const renewal = await session.renew(token, reason)
    if (renewal.kind === 'failed') throw new ApiRequestError(renewal.failure)
    if (renewal.kind === 'renewed') {
      const renewedToken = session.getAccessToken()
      if (renewedToken === null) throw new SessionEndedError()
      const retry = await call(renewedToken)
      if (retry.kind === 'ok') return retry.value
      if (retry.kind === 'httpProblem' && session.getAccessToken() === renewedToken) {
        const retryReason = arrivalReasonFromUnauthorized(retry.status, retry.problem?.code ?? null)
        if (retryReason === 'sessionExpired' || retryReason === 'sessionInvalid') session.end(retryReason)
      }
      throw new ApiRequestError(retry)
    }
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
