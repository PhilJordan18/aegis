import type { QueryClient, QueryFilters } from '@tanstack/react-query'

/** Reads every matching query again; resolves to whether all of them succeeded (« Actualiser », contract §1.5). */
export async function refetchAll(client: QueryClient, filters: readonly QueryFilters[]): Promise<boolean> {
  const results = await Promise.allSettled(filters.map((filter) => client.refetchQueries(filter, { throwOnError: true })))
  return results.every((result) => result.status === 'fulfilled')
}
