import type { AdminAssetView } from '../catalog/contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?casier=<uuid>`: a locker named in the address. Anything else is ignored, never put in a request path. */
export function lockerIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('casier')
  return value !== null && UUID.test(value) ? value.toLowerCase() : null
}

/**
 * P0 has no « list of lockers » route (09 §16 serves one locker by id). The lockers the Manager knows are the ones
 * the catalog places units in (`placement.lockerId`, 09 §8.2), in the order the units come, each once.
 */
export function lockerIdsFromPlacements(assets: readonly AdminAssetView[]): readonly string[] {
  const ids: string[] = []
  for (const asset of assets) {
    const id = asset.placement?.lockerId
    if (id !== undefined && !ids.includes(id)) ids.push(id)
  }
  return ids
}
