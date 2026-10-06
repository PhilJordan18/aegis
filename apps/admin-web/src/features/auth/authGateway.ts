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
      readonly kind: 'network'
      /**
       * `notConfigured`: this build has no HTTP adapter yet. Reported as
       * unreachable rather than pretending that a sign-in happened.
       */
      readonly reason: 'offline' | 'timeout' | 'notConfigured'
    }
  | { readonly kind: 'aborted' }

/**
 * Boundary between the Manager UI and the Aegis Control API.
 *
 * Future HTTP adapter (integration slice, not implemented here). It must:
 * - send `POST /api/v1/auth/login` with a JSON `LoginRequest`
 *   (`Content-Type: application/json`) and read a `LoginResponse` (09 §10.2);
 * - send `GET /api/v1/auth/me` with `Authorization: Bearer <token>` (09 §4.3, §10.3);
 * - parse `application/problem+json` bodies into `ProblemResponse` (09 §7), and
 *   return `problem: null` when a body is missing or malformed instead of guessing;
 * - pass the raw `Retry-After` header of a 429 (09 §23.4);
 * - send an `X-Request-Id` and return the response's `X-Request-Id`; with the
 *   problem `traceId`, it identifies the request for support (09 §6.1);
 * - apply a timeout and honour `signal`, mapping to `network`/`aborted`;
 * - never log, persist or echo the password or the access token;
 * - rely on an exact-origin CORS configuration on the API (09 §23.1, not configured yet).
 */
export interface AuthGateway {
  signIn(request: LoginRequest, signal?: AbortSignal): Promise<GatewayResult<LoginResponse>>
  currentProfile(accessToken: string, signal?: AbortSignal): Promise<GatewayResult<UserProfile>>
}

/** Used by builds without an HTTP adapter: every call honestly fails as unreachable. */
export const unconfiguredAuthGateway: AuthGateway = {
  signIn: async () => ({ kind: 'network', reason: 'notConfigured' }),
  currentProfile: async () => ({ kind: 'network', reason: 'notConfigured' }),
}
