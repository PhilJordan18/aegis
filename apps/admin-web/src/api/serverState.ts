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

/**
 * Clears every cached query whenever the signed-in account changes or the session ends. A token renewal
 * for the same account (ADR-016) keeps the cache: it would only blank pages that are being read.
 * Returns the unsubscribe function.
 */
export function clearCacheOnSessionChange(client: QueryClient, session: SessionStore): () => void {
  const accountOf = () => {
    const snapshot = session.getSnapshot()
    return snapshot.status === 'authenticated' ? snapshot.profile.id : null
  }
  let account = accountOf()
  return session.subscribe(() => {
    const next = accountOf()
    if (next === account) return
    account = next
    // A read still running for the previous account must not land in the next one's cache.
    void client.cancelQueries()
    client.clear()
  })
}
