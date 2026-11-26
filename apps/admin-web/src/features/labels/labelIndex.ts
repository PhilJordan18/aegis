import type { AdminAssetPage } from '../catalog/contract'
import type { AdminLockerPage } from '../custody/contract'

/**
 * Identifier → label resolution for every Manager page (contrat-web-manager §1.1). Built from bounded reads only: one
 * page of lockers and at most `MAX_ASSET_PAGES` pages of units, never one request per row. A label names the thing the
 * identifier designates: a unit's code comes from its `assetId`, a cell's code from its `compartmentId`. Nothing here
 * infers which unit a past fact concerned from what a cell holds today.
 */

/** 09 §11.1: `size` is 1 to 100. */
export const ASSET_INDEX_PAGE_SIZE = 100
/** 5 × 100 units (§1.1, B1/B6): beyond, units stay identifiers and the page says the labels are partial. */
export const MAX_ASSET_PAGES = 5

export type AssetLabel =
  | { readonly kind: 'known'; readonly code: string; /** null when only the code is known (a cell's current unit). */ readonly modelName: string | null; readonly archived: boolean }
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown' }

export type CompartmentLabel =
  | { readonly kind: 'known'; readonly code: string; readonly lockerCode: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown' }

export type LockerLabel = { readonly kind: 'known'; readonly code: string } | { readonly kind: 'pending' } | { readonly kind: 'unknown' }

/** `failed`: nothing could be read; `partial`: some units are beyond the bounded read or a page failed. */
export type IndexHealth = 'pending' | 'ready' | 'partial' | 'failed'

export interface LabelIndex {
  readonly asset: (assetId: string) => AssetLabel
  readonly compartment: (compartmentId: string) => CompartmentLabel
  readonly locker: (lockerId: string) => LockerLabel
  readonly health: IndexHealth
}

export interface IndexReads {
  readonly lockers: { readonly data: AdminLockerPage | undefined; readonly failed: boolean }
  /** The unit pages, in order; `data` undefined while pending or after a failure. */
  readonly assets: readonly { readonly data: AdminAssetPage | undefined; readonly failed: boolean }[]
}

/** How many unit pages the index reads, once the first page told how many exist. */
export const assetPagesToRead = (first: AdminAssetPage | undefined): number => (first === undefined ? 1 : Math.max(1, Math.min(first.totalPages, MAX_ASSET_PAGES)))

export function buildLabelIndex({ lockers, assets }: IndexReads): LabelIndex {
  const compartments = new Map<string, { code: string; lockerCode: string }>()
  const lockerCodes = new Map<string, string>()
  const currentCodes = new Map<string, string>()
  for (const locker of lockers.data?.items ?? []) {
    lockerCodes.set(locker.id, locker.code)
    for (const compartment of locker.compartments) {
      compartments.set(compartment.id, { code: compartment.code, lockerCode: locker.code })
      // Source 3 of §1.1: the unit's own code, keyed by the unit's id; never the cell → unit relation.
      if (compartment.currentAsset !== null) currentCodes.set(compartment.currentAsset.id, compartment.currentAsset.assetCode)
    }
  }
  const units = new Map<string, { code: string; modelName: string; archived: boolean }>()
  for (const page of assets) for (const unit of page.data?.items ?? []) units.set(unit.id, { code: unit.assetCode, modelName: unit.model.name, archived: unit.archivedAt !== null })

  const lockersPending = lockers.data === undefined && !lockers.failed
  const assetsPending = assets.some((page) => page.data === undefined && !page.failed)
  const first = assets[0]?.data
  const truncated = first !== undefined && first.totalItems > MAX_ASSET_PAGES * ASSET_INDEX_PAGE_SIZE
  const anyFailed = lockers.failed || assets.some((page) => page.failed)
  const allFailed = lockers.failed && (assets[0]?.failed ?? true)
  const health: IndexHealth = lockersPending || assetsPending ? 'pending' : allFailed ? 'failed' : anyFailed || truncated ? 'partial' : 'ready'

  return {
    health,
    asset: (assetId) => {
      const unit = units.get(assetId)
      if (unit !== undefined) return { kind: 'known', code: unit.code, modelName: unit.modelName, archived: unit.archived }
      if (assetsPending) return { kind: 'pending' }
      const code = currentCodes.get(assetId)
      if (code !== undefined) return { kind: 'known', code, modelName: null, archived: false }
      return lockersPending ? { kind: 'pending' } : { kind: 'unknown' }
    },
    compartment: (compartmentId) => {
      const known = compartments.get(compartmentId)
      if (known !== undefined) return { kind: 'known', ...known }
      return lockersPending ? { kind: 'pending' } : { kind: 'unknown' }
    },
    locker: (lockerId) => {
      const code = lockerCodes.get(lockerId)
      if (code !== undefined) return { kind: 'known', code }
      return lockersPending ? { kind: 'pending' } : { kind: 'unknown' }
    },
  }
}

/** « 6c0d7d3e… »: the abbreviated form of an identifier (8 characters). */
export const abbreviate = (id: string): string => `${id.slice(0, 8)}…`
