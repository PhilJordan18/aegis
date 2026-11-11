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
