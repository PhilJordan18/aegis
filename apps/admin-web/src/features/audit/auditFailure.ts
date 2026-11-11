import { ApiRequestError } from '../../api/serverState'
import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed audit read means. `400 INVALID_CURSOR` (§22.2) means the page chain must restart from the first page.
 * `404 RESOURCE_NOT_FOUND` on this list proves neither an empty history nor an unimplemented route: it is a traced
 * service error, and absence of evidence is never shown as « nothing happened ».
 */
export type AuditFailure = CatalogFailure | { readonly kind: 'invalidCursor' }

export function classifyAuditFailure(error: unknown): AuditFailure {
  if (error instanceof ApiRequestError && error.failure.kind === 'httpProblem' && error.failure.problem?.code === 'INVALID_CURSOR') {
    return { kind: 'invalidCursor' }
  }
  const failure = classifyCatalogFailure(error)
  if (failure.kind !== 'notFound') return failure
  const traceId = error instanceof ApiRequestError && error.failure.kind === 'httpProblem' ? (error.failure.problem?.traceId ?? error.failure.requestId) : null
  return { kind: 'serviceError', traceId }
}
