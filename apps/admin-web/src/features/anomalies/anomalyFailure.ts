import { ApiRequestError } from '../../api/serverState'
import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed anomaly read means for the screen. A list route answering `404 RESOURCE_NOT_FOUND` is « not served
 * yet » (`ApiRoutes` declares it before its controller exists); on a detail route the same answer is a missing record.
 */
export type AnomalyReadFailure = CatalogFailure | { readonly kind: 'notServed' }

export function classifyAnomalyReadFailure(error: unknown, route: 'list' | 'detail'): AnomalyReadFailure {
  const failure = classifyCatalogFailure(error)
  return failure.kind === 'notFound' && route === 'list' ? { kind: 'notServed' } : failure
}

/**
 * What a refused acknowledgement means (§18.2). Both 409 codes call for a fresh read of the anomaly, never a local
 * status change: the server's view is the truth, and an anomaly resolved meanwhile is shown resolved.
 */
export type AcknowledgeFailure =
  | AnomalyReadFailure
  | { readonly kind: 'alreadyResolved' }
  | { readonly kind: 'notAcknowledgeable' }
  | { readonly kind: 'invalidNote' }

export function classifyAcknowledgeFailure(error: unknown): AcknowledgeFailure {
  if (error instanceof ApiRequestError && error.failure.kind === 'httpProblem') {
    const code = error.failure.problem?.code
    if (code === 'ANOMALY_ALREADY_RESOLVED') return { kind: 'alreadyResolved' }
    if (code === 'ANOMALY_NOT_ACKNOWLEDGEABLE') return { kind: 'notAcknowledgeable' }
    if (code === 'VALIDATION_ERROR') return { kind: 'invalidNote' }
  }
  return classifyAnomalyReadFailure(error, 'detail')
}
