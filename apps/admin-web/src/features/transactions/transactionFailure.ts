import { classifyCatalogFailure, type CatalogFailure } from '../catalog/catalogFailure'

/**
 * What a failed §17 read means for the screen. On top of the catalogue's kinds, a list route that answers
 * `404 RESOURCE_NOT_FOUND` is « not served yet »: `ApiRoutes` declares the route, and the API answers it this way
 * until its controller exists. A detail route cannot tell that apart from a missing record, so there it stays
 * `notFound`; the screen learns from the list read whether the service exists.
 */
export type TransactionFailure = CatalogFailure | { readonly kind: 'notServed' }

export function classifyTransactionFailure(error: unknown, route: 'list' | 'detail'): TransactionFailure {
  const failure = classifyCatalogFailure(error)
  return failure.kind === 'notFound' && route === 'list' ? { kind: 'notServed' } : failure
}
