import { describe, expect, it } from 'vitest'
import { periodInstants } from './transactionQuery'
import { isCalendarDay, NO_FILTERS, readTransactionLocation, transactionHref } from './transactionHref'

const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('transaction address', () => {
  it('round-trips the view, filters, page and selection', () => {
    const filters = { status: 'ACTIVE', assetId: UUID, from: '2026-11-01', to: '2026-11-10' }
    const href = transactionHref({ view: 'loans', page: 2, selectedId: UUID, filters })
    expect(href).toBe(`/reservations-prets?vue=prets&statut=ACTIVE&equipement=${UUID}&du=2026-11-01&au=2026-11-10&page=3&dossier=${UUID}`)
    const read = readTransactionLocation(href.split('?')[1] ?? '')
    expect(read).toEqual({ view: 'loans', page: 2, selectedId: UUID, filters })
  })

  it('keeps the bare path for the default view and no filter', () => {
    expect(transactionHref({ view: 'reservations', filters: NO_FILTERS })).toBe('/reservations-prets')
    expect(readTransactionLocation('').view).toBe('reservations')
  })

  it('takes a status only from the view it belongs to', () => {
    expect(readTransactionLocation('vue=prets&statut=RETURN_PENDING').filters.status).toBe('RETURN_PENDING')
    expect(readTransactionLocation('vue=reservations&statut=RETURN_PENDING').filters.status).toBeNull()
    expect(readTransactionLocation('vue=operations&statut=ANOMALY').filters.status).toBe('ANOMALY')
  })

  it('ignores unusable values', () => {
    const read = readTransactionLocation('vue=x&page=abc&dossier=nope&equipement=1&du=2026-13-01&au=hier')
    expect(read).toEqual({ view: 'reservations', page: 0, selectedId: null, filters: NO_FILTERS })
    expect(isCalendarDay('2026-02-29')).toBe(false)
    expect(isCalendarDay('2028-02-29')).toBe(true)
  })
})

describe('periodInstants (09 §17: from inclusive, to exclusive; laboratory zone)', () => {
  it('starts « Du » at the laboratory midnight and ends « Au » at the midnight after it', () => {
    expect(periodInstants({ from: '2026-11-10', to: '2026-11-10' })).toEqual({ from: '2026-11-10T05:00:00Z', to: '2026-11-11T05:00:00Z' })
  })

  it('follows the clock change of 1 November 2026 (EDT to EST)', () => {
    expect(periodInstants({ from: '2026-11-01', to: '2026-11-01' })).toEqual({ from: '2026-11-01T04:00:00Z', to: '2026-11-02T05:00:00Z' })
  })

  it('sends only the bounds that are set', () => {
    expect(periodInstants({ from: null, to: null })).toEqual({})
    expect(periodInstants({ from: '2026-07-01', to: null })).toEqual({ from: '2026-07-01T04:00:00Z' })
  })
})
