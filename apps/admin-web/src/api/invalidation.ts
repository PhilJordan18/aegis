import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './queryKeys'

function sameKey(a: QueryKey, b: QueryKey): boolean {
  return a.length === b.length && a.every((part, index) => Object.is(part, b[index]))
}

/**
 * The Manager has learned that a custody fact changed (an operation ended: reservation, loan and availability moved).
 * Every read that shows one of them is marked stale together, so a screen entered later never mixes the new dossier
 * with an old list, count or availability: the units (lists and dossiers), the reservation, loan and operation reads,
 * the Vue d'ensemble blocks and the anomalies (a failed or incoherent operation raises one). Only what is on screen
 * is read again now; the rest is read when its screen is next entered. `except` keeps one read from being asked
 * again by the very change it just delivered.
 */
export function refreshCustodyFacts(client: QueryClient, { except }: { readonly except?: QueryKey } = {}): void {
  const kept = (query: Query) => except === undefined || !sameKey(query.queryKey, except)
  for (const queryKey of [queryKeys.catalog.assets, queryKeys.transactions.all, queryKeys.overview.all, queryKeys.anomalies.all]) {
    void client.invalidateQueries({ queryKey, predicate: kept })
  }
}

/**
 * The Manager changed what a reservation, a loan or an operation names about a unit (its code, its model, its
 * placement): those reads carry a copy of it (09 §8.9 summaries), and the Vue d'ensemble blocks show it. The catalog
 * itself is invalidated by the mutation that knows which dossier the server answered with.
 */
export function refreshAssetSummaries(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.transactions.all })
  void client.invalidateQueries({ queryKey: queryKeys.overview.all })
}
