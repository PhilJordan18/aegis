import { ApiRequestError } from '../../api/serverState'
import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed anomaly read means for the screen. `404 RESOURCE_NOT_FOUND` names a missing anomaly only on a detail
 * route; on the list it proves neither an empty list nor an unimplemented route, so it is a traced service error.
 */
export type AnomalyReadFailure = CatalogFailure

export function classifyAnomalyReadFailure(error: unknown, route: 'list' | 'detail'): AnomalyReadFailure {
  const failure = classifyCatalogFailure(error)
  if (failure.kind !== 'notFound' || route === 'detail') return failure
  const traceId = error instanceof ApiRequestError && error.failure.kind === 'httpProblem' ? (error.failure.problem?.traceId ?? error.failure.requestId) : null
  return { kind: 'serviceError', traceId }
}

/**
 * What a refused acknowledgement means (§18.2). Both 409 codes call for a fresh read of the anomaly, never a local
 * status change: the server's view is the truth, and an anomaly resolved meanwhile is shown resolved.
 */
export type AcknowledgeFailure =
  | AnomalyReadFailure
  | { readonly kind: 'alreadyResolved' }
  | { readonly kind: 'notAcknowledgeable' }
  | { readonly kind: 'invalidNote'; readonly violations: readonly string[] }
  /** 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`: the first attempt is still running; repeating the same intent applies nothing twice. */
  | { readonly kind: 'inProgress' }

export function classifyAcknowledgeFailure(error: unknown): AcknowledgeFailure {
  if (error instanceof ApiRequestError && error.failure.kind === 'httpProblem') {
    const code = error.failure.problem?.code
    if (code === 'ANOMALY_ALREADY_RESOLVED') return { kind: 'alreadyResolved' }
    if (code === 'ANOMALY_NOT_ACKNOWLEDGEABLE') return { kind: 'notAcknowledgeable' }
    if (code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS') return { kind: 'inProgress' }
    if (code === 'VALIDATION_ERROR') {
      const violations = error.failure.problem?.violations ?? []
      return { kind: 'invalidNote', violations: violations.filter((violation) => violation.field === 'note').map((violation) => violation.code) }
    }
  }
  return classifyAnomalyReadFailure(error, 'detail')
}
