import { vi } from 'vitest'
import type { GatewayResult } from '../auth/authGateway'
import type { CatalogGateway } from './catalogGateway'
import type { AdminAssetPage, AdminAssetView, AssetModelPage, AssetModelView } from './contract'

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

type Mocked<T> = { [K in keyof T]: T[K] & ReturnType<typeof vi.fn> }

/**
 * A fake gateway: the lists by zero-based page index, and the units by id. Anything not provided is
 * unreachable. `overrides` replaces any method, typically a mutation under test.
 */
export function fakeCatalogGateway({
  pages = [],
  units = {},
  modelPages = [],
  overrides = {},
}: {
  pages?: readonly Answer<AdminAssetPage>[]
  units?: Readonly<Record<string, Answer<AdminAssetView>>>
  modelPages?: readonly Answer<AssetModelPage>[]
  overrides?: Partial<CatalogGateway>
} = {}): Mocked<CatalogGateway> {
  const offline = async () => ({ kind: 'network', reason: 'offline' }) as const
  const base: CatalogGateway = {
    listAssets: async (_token, query) => {
      const answer = pages[query.page]
      return answer === undefined ? offline() : resolve(answer)
    },
    getAsset: async (_token, assetId) => {
      const answer = units[assetId]
      return answer === undefined ? offline() : resolve(answer)
    },
    listModels: async (_token, query) => {
      const answer = modelPages[query.page]
      return answer === undefined ? offline() : resolve(answer)
    },
    createAsset: offline,
    updateAsset: offline,
    archiveAsset: offline,
    createModel: offline,
    updateModel: offline,
    archiveModel: offline,
    ...overrides,
  }
  return Object.fromEntries(Object.entries(base).map(([name, fn]) => [name, vi.fn(fn)])) as unknown as Mocked<CatalogGateway>
}

export function model(overrides: Partial<AssetModelView> & { id: string; name: string }): AssetModelView {
  return { manufacturer: null, modelNumber: null, description: null, defaultCalibrationRequired: false, archivedAt: null, ...overrides }
}

export const FLUKE_117 = model({
  id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01',
  name: 'Multimètre 1',
  manufacturer: 'Fluke',
  modelNumber: '117',
  defaultCalibrationRequired: true,
})

export function modelPageOf(items: readonly AssetModelView[], overrides: Partial<AssetModelPage> = {}): AssetModelPage {
  return { items, page: 0, size: 100, totalItems: items.length, totalPages: items.length === 0 ? 0 : 1, ...overrides }
}
