import { ApiRequestError } from '../../api/serverState'
import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed §17 read means for the screen. `404 RESOURCE_NOT_FOUND` names a missing record only on a detail
 * route. On a list it proves nothing (not an empty list, not an unimplemented route), so it is a service error that
 * keeps its trace id for diagnosis.
 */
export type TransactionFailure = CatalogFailure

export function classifyTransactionFailure(error: unknown, route: 'list' | 'detail'): TransactionFailure {
  const failure = classifyCatalogFailure(error)
  if (failure.kind !== 'notFound' || route === 'detail') return failure
  const traceId = error instanceof ApiRequestError && error.failure.kind === 'httpProblem' ? (error.failure.problem?.traceId ?? error.failure.requestId) : null
  return { kind: 'serviceError', traceId }
}
