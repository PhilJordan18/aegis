import { ApiRequestError, SessionEndedError } from '../../api/serverState'

/**
 * What a failed catalog read means for the screen. Texts come from the catalog by kind, never from
 * the server's `title` or `detail` (handoff §0.3).
 */
export type CatalogFailure =
  /** 401 or no token: the session store already sent the user back to sign-in; show nothing meanwhile. */
  | { readonly kind: 'ended' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'serviceError'; readonly traceId: string | null }

export function classifyCatalogFailure(error: unknown): CatalogFailure {
  if (error instanceof SessionEndedError) return { kind: 'ended' }
  if (!(error instanceof ApiRequestError)) return { kind: 'serviceError', traceId: null }
  const { failure } = error
  switch (failure.kind) {
    case 'network':
    case 'aborted':
      return { kind: 'unreachable' }
    case 'invalidResponse':
      return { kind: 'serviceError', traceId: failure.requestId }
    case 'httpProblem': {
      const { status, problem } = failure
      if (status === 401) return { kind: 'ended' }
      if (status === 403) return { kind: 'forbidden' }
      if (status === 404) return { kind: 'notFound' }
      // A gateway answer without a problem body (proxy down, 502, 504) says nothing about the API itself.
      if (status >= 500 && problem === null) return { kind: 'unreachable' }
      return { kind: 'serviceError', traceId: problem?.traceId ?? failure.requestId }
    }
  }
}
