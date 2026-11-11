/** Fictional §19 records for tests only; never imported by production code. */
export const EVENT_ID = '5d6e7f80-91a2-4b3c-8d4e-5f60718293a4'
export const SUBJECT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'
export const ADMIN_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'

export const auditEvent = (overrides: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  eventType: 'ASSET_UPDATED',
  actor: { id: ADMIN_ID, displayName: 'Administrateur de démonstration' },
  subjectType: 'ASSET',
  subjectId: SUBJECT_ID,
  operationId: null,
  fromState: null,
  toState: null,
  result: 'ACCEPTED',
  reason: null,
  occurredAt: '2026-11-10T18:30:00Z',
  details: {},
  ...overrides,
})
