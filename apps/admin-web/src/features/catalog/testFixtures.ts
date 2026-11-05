import { vi } from 'vitest'
import type { GatewayResult } from '../auth/authGateway'
import type { CatalogGateway } from './catalogGateway'
import type { AdminAssetPage, AdminAssetView } from './contract'

export const EVALUATED_AT = '2026-10-21T14:30:00Z'

/**
 * What the API sends today: presence is never observed (PHY-01), so presence is UNKNOWN,
 * placement null, and UNKNOWN_PHYSICAL_STATE is always among the reasons.
 */
export function asset(overrides: Partial<AdminAssetView> & { id: string; assetCode: string }): AdminAssetView {
  return {
    serialNumber: null,
    model: { id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01', name: 'Multimètre 1', manufacturer: 'Fluke', modelNumber: '117' },
    requiredAccessLevel: 'STANDARD',
    operationalStatus: 'SERVICEABLE',
    calibration: { required: true, dueAt: '2026-12-01T05:00:00Z', status: 'VALID' },
    availability: 'AVAILABLE',
    presence: 'UNKNOWN',
    placement: null,
    operationalDiagnostic: { evaluatedAt: EVALUATED_AT, reasons: ['UNKNOWN_PHYSICAL_STATE'] },
    archivedAt: null,
    ...overrides,
  }
}

export const MM001 = asset({ id: '300e72fd-118c-4d1f-af9c-7fb61e89f62c', assetCode: 'MM-001', serialNumber: 'FL-117-0042' })

export const MM002 = asset({
  id: '5a3d1c9e-2b7f-4e0a-8c11-6d9f2e7b4a02',
  assetCode: 'MM-002',
  model: { id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a02', name: 'Multimètre 2', manufacturer: 'Fluke', modelNumber: '117' },
  calibration: { required: true, dueAt: '2026-09-08T04:00:00Z', status: 'EXPIRED' },
  operationalDiagnostic: { evaluatedAt: EVALUATED_AT, reasons: ['CALIBRATION_EXPIRED', 'UNKNOWN_PHYSICAL_STATE'] },
})

export function pageOf(items: readonly AdminAssetView[], overrides: Partial<AdminAssetPage> = {}): AdminAssetPage {
  return { items, page: 0, size: 20, totalItems: items.length, totalPages: items.length === 0 ? 0 : 1, ...overrides }
}

export const ok = <T>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-catalog' })

type Answer<T> = GatewayResult<T> | (() => Promise<GatewayResult<T>>)

async function resolve<T>(answer: Answer<T>): Promise<GatewayResult<T>> {
  return typeof answer === 'function' ? answer() : answer
}

/** A fake gateway: the lists by zero-based page index, and the units by id. Anything not provided is unreachable. */
export function fakeCatalogGateway({
  pages = [],
  units = {},
}: {
  pages?: readonly Answer<AdminAssetPage>[]
  units?: Readonly<Record<string, Answer<AdminAssetView>>>
} = {}): CatalogGateway & { listAssets: ReturnType<typeof vi.fn>; getAsset: ReturnType<typeof vi.fn> } {
  const offline = { kind: 'network', reason: 'offline' } as const
  return {
    listAssets: vi.fn(async (_token: string, query: { page: number }) => {
      const answer = pages[query.page]
      return answer === undefined ? offline : resolve(answer)
    }),
    getAsset: vi.fn(async (_token: string, assetId: string) => {
      const answer = units[assetId]
      return answer === undefined ? offline : resolve(answer)
    }),
  }
}
