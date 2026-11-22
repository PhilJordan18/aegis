import type { LoginRequest, LoginResponse, ProblemResponse, UserProfile } from './contract'

/**
 * Transport-neutral outcome of one authentication call. The UI maps it with
 * `signInOutcome.ts`; it never inspects HTTP details itself.
 */
export type GatewayResult<T> =
  | { readonly kind: 'ok'; readonly value: T; readonly requestId: string | null }
  | GatewayFailure

export type GatewayFailure =
  | {
      readonly kind: 'httpProblem'
      readonly status: number
      /** Parsed problem+json body, or null when absent or not a valid §7 body. */
      readonly problem: ProblemResponse | null
      /** Raw `Retry-After` header (seconds or HTTP date), when present. */
      readonly retryAfter: string | null
      /** `X-Request-Id` response header, for support (§6.1). */
      readonly requestId: string | null
    }
  | {
      /**
       * A 2xx response whose body does not match the contract. Reported as a
       * service error rather than guessing a profile or a token.
       */
      readonly kind: 'invalidResponse'
      readonly status: number
      readonly requestId: string | null
    }
  | {
      readonly kind: 'network'
      /**
       * `notConfigured`: no adapter was provided (context default). Reported
       * as unreachable rather than pretending that a sign-in happened.
       */
      readonly reason: 'offline' | 'timeout' | 'notConfigured'
    }
  | { readonly kind: 'aborted' }

/**
 * Boundary between the Manager UI and the Aegis Control API. The production
 * adapter is `httpAuthGateway.ts`; the design-review preview has its own.
 *
 * Every adapter must:
 * - send `POST /api/v1/auth/login` with a JSON `BrowserLoginRequest` and read a
 *   `LoginResponse` (09 §10.2);
 * - send the three browser-session calls (login, refresh, revoke) with
 *   `credentials: 'same-origin'` and every other call with `'omit'`;
 * - send `GET /api/v1/auth/me` with `Authorization: Bearer <token>` (09 §4.3, §10.3);
 * - parse `application/problem+json` bodies into `ProblemResponse` (09 §7), and
 *   return `problem: null` when a body is missing or malformed instead of guessing;
 * - pass the raw `Retry-After` header of a 429 (09 §23.4);
 * - send an `X-Request-Id` and return the response's `X-Request-Id` (09 §6.1);
 * - apply a timeout and honour `signal`, mapping to `network`/`aborted`;
 * - never log, persist or echo the password or the access token.
 */
export interface AuthGateway {
  signIn(request: LoginRequest, signal?: AbortSignal): Promise<GatewayResult<LoginResponse>>
  currentProfile(accessToken: string, signal?: AbortSignal): Promise<GatewayResult<UserProfile>>
  /**
   * `POST /api/v1/auth/session/refresh` (09 §10.4, ADR-016): no body, the HttpOnly cookie travels
   * by itself. 200 has the shape of the login response; 401 AUTH_SESSION_INVALID ends the session.
   */
  refreshSession(signal?: AbortSignal): Promise<GatewayResult<LoginResponse>>
  /** `POST /api/v1/auth/session/revoke` (09 §10.5): 204, idempotent, also without a cookie. */
  revokeSession(signal?: AbortSignal): Promise<GatewayResult<true>>
}

/** Context default when no adapter is provided: every call honestly fails as unreachable. */
export const unconfiguredAuthGateway: AuthGateway = {
  signIn: async () => ({ kind: 'network', reason: 'notConfigured' }),
  currentProfile: async () => ({ kind: 'network', reason: 'notConfigured' }),
  refreshSession: async () => ({ kind: 'network', reason: 'notConfigured' }),
  revokeSession: async () => ({ kind: 'network', reason: 'notConfigured' }),
}
