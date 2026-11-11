import { ApiRequestError } from '../../api/serverState'
import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed audit read means. `404 RESOURCE_NOT_FOUND` on the list is « not served yet » (route declared, no
 * controller); `400 INVALID_CURSOR` (§22.2) means the page chain must restart from the first page.
 */
export type AuditFailure = CatalogFailure | { readonly kind: 'notServed' } | { readonly kind: 'invalidCursor' }

export function classifyAuditFailure(error: unknown): AuditFailure {
  if (error instanceof ApiRequestError && error.failure.kind === 'httpProblem' && error.failure.problem?.code === 'INVALID_CURSOR') {
    return { kind: 'invalidCursor' }
  }
  const failure = classifyCatalogFailure(error)
  return failure.kind === 'notFound' ? { kind: 'notServed' } : failure
}
