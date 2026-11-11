import { ApiRequestError } from '../../api/serverState'
import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed audit read means. `400 INVALID_CURSOR` (§22.2) means the page chain must restart from the first page.
 * Any other `400 VALIDATION_ERROR` is a filter the server refused: it names the offending query parameters, which the
 * screen shows against their fields, never as an empty history. `404 RESOURCE_NOT_FOUND` on this list proves neither an empty history nor an unimplemented route: it is a traced
 * service error, and absence of evidence is never shown as « nothing happened ».
 */
export type AuditFailure =
  | CatalogFailure
  | { readonly kind: 'invalidCursor' }
  /** `fields` are the query parameters the server named (§7 `violations[].field`); empty when it named none. */
  | { readonly kind: 'invalidFilter'; readonly fields: readonly string[] }

export function classifyAuditFailure(error: unknown): AuditFailure {
  if (error instanceof ApiRequestError && error.failure.kind === 'httpProblem') {
    const { status, problem } = error.failure
    if (problem?.code === 'INVALID_CURSOR') return { kind: 'invalidCursor' }
    if (status === 400 && problem?.code === 'VALIDATION_ERROR') return { kind: 'invalidFilter', fields: (problem.violations ?? []).map((violation) => violation.field) }
  }
  const failure = classifyCatalogFailure(error)
  if (failure.kind !== 'notFound') return failure
  const traceId = error instanceof ApiRequestError && error.failure.kind === 'httpProblem' ? (error.failure.problem?.traceId ?? error.failure.requestId) : null
  return { kind: 'serviceError', traceId }
}
