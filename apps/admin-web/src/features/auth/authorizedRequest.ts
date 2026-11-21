import { ApiRequestError, SessionEndedError, SessionRestoredError } from '../../api/serverState'
import type { AuthGateway, GatewayResult } from './authGateway'
import type { UserProfile } from './contract'
import type { SessionStore } from './session'
import { arrivalReasonFromUnauthorized } from './signInOutcome'

/**
 * Runs one protected READ with the in-memory token. A 401 (09 §4.3, §21; states.md §1) first asks the session store
 * for one renewal (ADR-016, 09 §10.4): concurrent 401s share a single refresh, and the idempotent read is retried
 * exactly once with the new token. A second 401, or a refused renewal, ends the session with the server's reason and
 * sends the user back to sign-in; it never loops. A renewal that could not reach the server throws that failure and
 * keeps the session, so the page shows its recoverable state with a retry. A response for a token that is no longer
 * current never ends the newer session. Commands use `authorizedCommand`, which never replays.
 */
export async function authorizedRequest<T>(session: SessionStore, call: (accessToken: string) => Promise<GatewayResult<T>>): Promise<T> {
  return run(session, call, true)
}

/**
 * Runs one protected COMMAND (a POST or PUT that changes state). Same renewal as a read, but a command that got a
 * 401 is never replayed by the Manager: once the session is restored it throws `SessionRestoredError`, and the user
 * submits again with the same `Idempotency-Key` of the intent (09 §6.2, §20.2). A refused renewal ends the session;
 * an unreachable server throws that failure.
 */
export async function authorizedCommand<T>(session: SessionStore, call: (accessToken: string) => Promise<GatewayResult<T>>): Promise<T> {
  return run(session, call, false)
}

async function run<T>(session: SessionStore, call: (accessToken: string) => Promise<GatewayResult<T>>, replay: boolean): Promise<T> {
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
      if (!replay) throw new SessionRestoredError()
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
 * GET /auth/me (09 §10.3): the server re-reads the account on every protected request (09 §4.1), so this confirms
 * that the session may still act as an administrator. A profile that is no longer ADMIN ends the session as invalid:
 * the Manager never keeps a token it may not use. A 403 never ends the session: it is an authorization answer, and
 * the pages show their own forbidden view; only a 401 (after the one allowed renewal) sends the user to sign-in.
 */
export async function fetchCurrentAdminProfile(gateway: AuthGateway, session: SessionStore, signal?: AbortSignal): Promise<UserProfile> {
  const token = session.getAccessToken()
  const profile = await authorizedRequest(session, (accessToken) => gateway.currentProfile(accessToken, signal))
  if (profile.role !== 'ADMIN') {
    if (token !== null && session.getAccessToken() === token) session.end('sessionInvalid')
    throw new SessionEndedError()
  }
  return profile
}
