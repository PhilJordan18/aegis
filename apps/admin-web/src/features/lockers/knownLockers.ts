import type { AdminAssetView } from '../catalog/contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?casier=<uuid>`: a locker named in the address. Anything else is ignored, never put in a request path. */
export function lockerIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('casier')
  return value !== null && UUID.test(value) ? value.toLowerCase() : null
}

/**
 * There is no usable « list of lockers » yet. Document 09 lists `GET /admin/lockers` (section 12, « Liste des lockers») and
 * ApiRoutes authorizes it for administrators, but no controller serves it and the contract gives it no response schema,
 * so this client does not call it. The lockers the Manager can name are the ones the catalog places units in
 * (`placement.lockerId`, 09 §8.2), in the order the units come, each once. That is a best effort: a locker with no placed
 * unit, or one placed past the first page of the catalog, is not found this way; `?casier=` names it directly.
 */
export function lockerIdsFromPlacements(assets: readonly AdminAssetView[]): readonly string[] {
  const ids: string[] = []
  for (const asset of assets) {
    const id = asset.placement?.lockerId
    if (id !== undefined && !ids.includes(id)) ids.push(id)
  }
  return ids
}
