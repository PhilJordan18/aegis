import { vi } from 'vitest'
import type { GatewayResult } from '../auth/authGateway'
import type { AnomalyGateway } from './anomalyGateway'
import type { AnomalyDetail, AnomalyPage, AnomalyView } from './contract'
import { parseAnomalyDetail, parseAnomalyView } from './contractParsers'

/** Fictional §18 records for tests only; never imported by production code. */
export const ANOMALY_ID = '8a9b0c1d-2e3f-4a5b-9c6d-7e8f9a0b1c2d'
export const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'
export const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const COMPARTMENT_ID = '4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b'
export const ADMIN_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'

export const anomalyView = (overrides: Record<string, unknown> = {}) => ({
  id: ANOMALY_ID,
  type: 'EXPECTED_ASSET_NOT_OBSERVED',
  severity: 'HIGH',
  status: 'OPEN',
  lockerOperationId: OPERATION_ID,
  assetId: ASSET_ID,
  compartmentId: COMPARTMENT_ID,
  detectedAt: '2026-11-10T19:02:00Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgementNote: null,
  resolvedAt: null,
  resolutionEvidenceObservationId: null,
  resolutionNote: null,
  summary: 'Équipement attendu non lu après la fermeture de la porte A1.',
  ...overrides,
})

export const acknowledgedView = (overrides: Record<string, unknown> = {}) =>
  anomalyView({
    status: 'ACKNOWLEDGED',
    acknowledgedAt: '2026-11-10T19:10:00Z',
    acknowledgedBy: { id: ADMIN_ID, displayName: 'Administrateur de démonstration' },
    acknowledgementNote: 'Inspection du compartiment planifiée.',
    ...overrides,
  })

// Typed builders and a fake gateway for component tests (the raw bodies above stay the parser's input).
export const SECOND_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
export const THIRD_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'
export const parsedAnomaly = (overrides: Record<string, unknown> = {}): AnomalyView => {
  const parsed = parseAnomalyView(anomalyView(overrides))
  if (parsed === null) throw new Error('fixture breaks the §8.7 contract')
  return parsed
}
export const parsedDetail = (overrides: Record<string, unknown> = {}): AnomalyDetail => {
  const parsed = parseAnomalyDetail({ evidence: [], ...anomalyView(overrides), ...overrides })
  if (parsed === null) throw new Error('fixture breaks the §8.7 contract')
  return parsed
}
export const OBSERVATION_ID = '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e'

export const ok = <T>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: null })
export const anomalyPageOf = (items: readonly AnomalyView[], extra: Partial<AnomalyPage> = {}): AnomalyPage => ({
  items,
  page: 0,
  size: 20,
  totalItems: items.length,
  totalPages: Math.max(Math.ceil(items.length / 20), 1),
  ...extra,
})

/** Every call is a spy, also an overridden one; script another answer with `mockImplementation`. */
export function fakeAnomalyGateway(overrides: Partial<AnomalyGateway> = {}) {
  return {
    listAnomalies: vi.fn<AnomalyGateway['listAnomalies']>(overrides.listAnomalies ?? (async () => ok(anomalyPageOf([])))),
    getAnomaly: vi.fn<AnomalyGateway['getAnomaly']>(overrides.getAnomaly ?? (async () => ({ kind: 'network', reason: 'offline' }))),
    acknowledge: vi.fn<AnomalyGateway['acknowledge']>(overrides.acknowledge ?? (async () => ({ kind: 'network', reason: 'offline' }))),
  }
}
