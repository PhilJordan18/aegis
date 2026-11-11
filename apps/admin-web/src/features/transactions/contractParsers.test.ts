import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNRECOGNIZED } from '../catalog/contract'
import { parseLoanPage, parseLoanView, parseLockerOperationPage, parseLockerOperationView, parseReservationPage, parseReservationView } from './contractParsers'
import { assetSummary, loanView, lockerOperationView, pageOf, reservationView } from './testFixtures'

afterEach(() => vi.restoreAllMocks())

describe('parseReservationView (09 §8.3)', () => {
  it('reads a complete reservation, keeping the holder as an id only', () => {
    const parsed = parseReservationView(reservationView())
    expect(parsed?.userId).toBe(reservationView().userId)
    expect(parsed?.asset.assetCode).toBe('MM-001')
    expect(parsed?.asset.placement?.compartmentCode).toBe('A1')
    expect(parsed).not.toHaveProperty('displayName')
  })

  it('accepts a closed reservation with its terminal instant and no placement', () => {
    const parsed = parseReservationView(reservationView({ status: 'EXPIRED', expiredAt: '2026-11-10T20:30:00Z', asset: { ...assetSummary, placement: null } }))
    expect(parsed?.status).toBe('EXPIRED')
    expect(parsed?.asset.placement).toBeNull()
  })

  it('tolerates an unknown status as UNRECOGNIZED, logging the field name only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseReservationView(reservationView({ status: 'ON_HOLD' }))?.status).toBe(UNRECOGNIZED)
    expect(warn.mock.calls[0]?.[0]).not.toContain('ON_HOLD')
  })

  it.each([
    ['a missing asset', { asset: undefined }],
    ['a non-UUID holder', { userId: 'jimmy' }],
    ['an impossible instant', { reservedUntil: '2026-02-30T10:00:00Z' }],
    ['a local time without zone', { reservedFrom: '2026-11-10T14:00:00' }],
    ['an empty status', { status: '' }],
    ['actions that are not strings', { availableActions: [1] }],
    ['a placement missing its compartment', { asset: { ...assetSummary, placement: { lockerId: assetSummary.placement.lockerId } } }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseReservationView(reservationView(overrides))).toBeNull()
  })
})

describe('parseLoanView (09 §8.4)', () => {
  it('reads the server overdue flag as sent, even when dueAt is in the future', () => {
    const parsed = parseLoanView(loanView({ overdue: true, dueAt: '2999-01-01T00:00:00Z' }))
    expect(parsed?.overdue).toBe(true)
    expect(parsed?.status).toBe('ACTIVE')
  })

  it('keeps a return in progress apart from the confirmed return', () => {
    const operation = '6f708192-a3b4-4c5d-8e6f-708192a3b4c5'
    const parsed = parseLoanView(loanView({ status: 'RETURN_PENDING', returnRequestedAt: '2026-11-10T19:00:00Z', currentOperationId: operation }))
    expect(parsed?.currentOperationId).toBe(operation)
    expect(parsed?.returnOperationId).toBeNull()
  })

  it.each([
    ['a missing overdue flag', { overdue: undefined }],
    ['an overdue flag as text', { overdue: 'true' }],
    ['a missing checkout operation', { checkoutOperationId: null }],
    ['a non-UUID current operation', { currentOperationId: 'op-1' }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseLoanView(loanView(overrides))).toBeNull()
  })
})

describe('§17 pages', () => {
  it('reads the §11.1 envelope, an empty page included', () => {
    expect(parseReservationPage(pageOf([reservationView()]))?.items).toHaveLength(1)
    expect(parseLoanPage(pageOf([]))).toEqual({ items: [], page: 0, size: 20, totalItems: 0, totalPages: 0 })
  })

  it('rejects the whole page when one item breaks the contract', () => {
    expect(parseLoanPage(pageOf([loanView(), loanView({ dueAt: null })]))).toBeNull()
    expect(parseReservationPage({ items: [], page: -1, size: 20, totalItems: 0, totalPages: 0 })).toBeNull()
  })
})

describe('parseLockerOperationView (09 §8.5)', () => {
  it('reads a complete operation as ids and the instants sent, with no display name', () => {
    const parsed = parseLockerOperationView(lockerOperationView())
    expect(parsed?.status).toBe('CONFIRMED')
    expect(parsed?.acknowledgedAt).toBe('2026-11-10T14:01:32Z')
    expect(parsed?.assetId).toBe(lockerOperationView().assetId)
    expect(parsed).not.toHaveProperty('displayName')
    expect(parsed).not.toHaveProperty('asset')
  })

  it('keeps an absent step as null and does not infer it from a later one', () => {
    const parsed = parseLockerOperationView(lockerOperationView({ status: 'COMMAND_ACKNOWLEDGED', acknowledgedAt: '2026-11-10T14:01:32Z', doorOpenedAt: null, confirmedAt: null, terminalAt: null, requiredAction: 'WAIT' }))
    expect(parsed?.doorOpenedAt).toBeNull()
    expect(parsed?.confirmedAt).toBeNull()
  })

  it('tolerates unknown type, status and required action per value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parsed = parseLockerOperationView(lockerOperationView({ type: 'AUDIT', status: 'PAUSED', requiredAction: 'CALL' }))
    expect([parsed?.type, parsed?.status, parsed?.requiredAction]).toEqual([UNRECOGNIZED, UNRECOGNIZED, UNRECOGNIZED])
  })

  it.each([
    ['a non-UUID compartment', { compartmentId: 'A1' }],
    ['a missing creation instant', { createdAt: undefined }],
    ['an impossible instant', { doorOpenedAt: '2026-02-30T10:00:00Z' }],
    ['a failure reason that is not text', { failureReason: 3 }],
    ['an empty status', { status: '' }],
    ['a non-UUID anomaly', { anomalyId: 'x' }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseLockerOperationView(lockerOperationView(overrides))).toBeNull()
  })

  it('reads the §11.1 envelope and rejects one broken item', () => {
    expect(parseLockerOperationPage(pageOf([lockerOperationView()]))?.totalItems).toBe(1)
    expect(parseLockerOperationPage(pageOf([lockerOperationView(), { id: 'x' }]))).toBeNull()
  })
})
