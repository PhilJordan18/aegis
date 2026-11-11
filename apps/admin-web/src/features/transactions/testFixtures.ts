/** Fictional §17 records for tests only; never imported by production code. */
export const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const USER_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
export const RESERVATION_ID = '7b726e56-2a19-44de-887b-d3e2bfc8bf28'
export const LOAN_ID = '5e6f7081-92a3-4b4c-9d5e-6f708192a3b4'
export const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'

export const assetSummary = {
  id: ASSET_ID,
  assetCode: 'MM-001',
  model: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Multimètre numérique', manufacturer: 'Fluke', modelNumber: '117' },
  placement: { lockerId: '3d4e5f60-7182-4a93-8ba4-c5d6e7f80912', lockerCode: 'AEGIS-DEMO-01', compartmentId: '4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b', compartmentCode: 'A1' },
}

export const reservationView = (overrides: Record<string, unknown> = {}) => ({
  id: RESERVATION_ID,
  asset: assetSummary,
  userId: USER_ID,
  status: 'ACTIVE',
  reservedFrom: '2026-11-10T14:00:00Z',
  reservedUntil: '2026-11-10T20:30:00Z',
  createdAt: '2026-11-10T14:00:00Z',
  cancelledAt: null,
  fulfilledAt: null,
  expiredAt: null,
  currentOperationId: null,
  availableActions: [],
  ...overrides,
})

export const loanView = (overrides: Record<string, unknown> = {}) => ({
  id: LOAN_ID,
  asset: assetSummary,
  holderUserId: USER_ID,
  status: 'ACTIVE',
  checkedOutAt: '2026-11-10T14:05:00Z',
  dueAt: '2026-11-10T20:30:00Z',
  overdue: false,
  returnRequestedAt: null,
  returnedAt: null,
  checkoutOperationId: OPERATION_ID,
  returnOperationId: null,
  currentOperationId: null,
  availableActions: [],
  ...overrides,
})

export const pageOf = (items: unknown[], overrides: Record<string, unknown> = {}) => ({ items, page: 0, size: 20, totalItems: items.length, totalPages: items.length === 0 ? 0 : 1, ...overrides })
