import { ApiRequestError, SessionEndedError } from '../../api/serverState'

export interface FieldViolation {
  readonly field: string
  readonly code: string
}

/**
 * What a refused or failed catalog mutation means for a form. Texts come from the catalogs by code, never
 * from the server's `title`, `detail` or violation `message` (09 §6.4, §7.1).
 */
export type MutationFailure =
  /** 401 or no token: the session store already sent the user back to sign-in. */
  | { readonly kind: 'ended' }
  /**
   * No answer (offline, timeout, gateway without a body). The outcome is unknown: repeating the same intent
   * with the same `Idempotency-Key` cannot apply it twice (09 §20.2).
   */
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'notFound' }
  /** 400 `VALIDATION_ERROR`: violations by field. The list is not exhaustive (09 §7.1). */
  | { readonly kind: 'validation'; readonly violations: readonly FieldViolation[]; readonly traceId: string | null }
  /** A stable business refusal (409, 422) the screen explains by its code; an unknown code stays generic. */
  | { readonly kind: 'refused'; readonly code: string; readonly traceId: string | null }
  /** 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`: the first attempt is still running; nothing was applied twice. */
  | { readonly kind: 'inProgress' }
  | { readonly kind: 'serviceError'; readonly traceId: string | null }

export function classifyMutationFailure(error: unknown): MutationFailure {
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
      const traceId = problem?.traceId ?? failure.requestId
      if (status === 401) return { kind: 'ended' }
      if (status === 403) return { kind: 'forbidden' }
      if (status === 404) return { kind: 'notFound' }
      if (status >= 500 && problem === null) return { kind: 'unreachable' }
      if (problem === null || status >= 500) return { kind: 'serviceError', traceId }
      if (status === 400 && problem.code === 'VALIDATION_ERROR') {
        return { kind: 'validation', violations: (problem.violations ?? []).map(({ field, code }) => ({ field, code })), traceId }
      }
      if (status === 409 && problem.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS') return { kind: 'inProgress' }
      return { kind: 'refused', code: problem.code, traceId }
    }
  }
}
