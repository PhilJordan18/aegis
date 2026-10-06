import { QueryClient } from '@tanstack/react-query'
import type { GatewayFailure } from '../features/auth/authGateway'
import type { SessionStore } from '../features/auth/session'

/** A failed API call, as data. The message carries the status and code only, never a token or a body. */
export class ApiRequestError extends Error {
  readonly failure: GatewayFailure

  constructor(failure: GatewayFailure) {
    super(
      failure.kind === 'httpProblem'
        ? `API request failed: ${failure.status} ${failure.problem?.code ?? 'no problem body'}`
        : `API request failed: ${failure.kind}`,
    )
    this.name = 'ApiRequestError'
    this.failure = failure
  }
}

/** The session ended (or never existed) before or while the request ran; the caller is leaving the protected area. */
export class SessionEndedError extends Error {
  constructor() {
    super('The administrator session has ended')
    this.name = 'SessionEndedError'
  }
}

const MAX_RETRIES = 2

/** Only transport failures and 5xx are retried; 4xx answers are authoritative (09 §21). */
export function isTransientFailure(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false
  const { failure } = error
  return failure.kind === 'network' || (failure.kind === 'httpProblem' && failure.status >= 500)
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => failureCount < MAX_RETRIES && isTransientFailure(error),
        staleTime: 30_000,
      },
      // Commands are never replayed automatically; custody-critical ones need explicit user intent.
      mutations: { retry: false },
    },
  })
}

/** Clears every cached query whenever the access token changes. Returns the unsubscribe function. */
export function clearCacheOnSessionChange(client: QueryClient, session: SessionStore): () => void {
  let token = session.getAccessToken()
  return session.subscribe(() => {
    const next = session.getAccessToken()
    if (next === token) return
    token = next
    client.clear()
  })
}
