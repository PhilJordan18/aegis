import { describe, expect, it } from 'vitest'
import { AUDIT_PAGE_SIZE, NO_FILTERS, activeFilterFields, auditHref, readAuditLocation, refusedFields, toAuditQuery } from './auditFilters'
import { uuid } from './testFixtures'

describe('readAuditLocation', () => {
  it('reads the filters, trimmed, and the selected event', () => {
    const location = readAuditLocation(`?type=COMMAND_SENT&sujetType=LOCKER_OPERATION&sujet=${uuid(2)}&operation=${uuid(3)}&acteur=${uuid(4)}&du=2026-11-10&au=2026-11-11&evenement=${uuid(5).toUpperCase()}`)
    expect(location.filters).toEqual({
      eventType: 'COMMAND_SENT',
      subjectType: 'LOCKER_OPERATION',
      subjectId: uuid(2),
      operationId: uuid(3),
      actorUserId: uuid(4),
      from: '2026-11-10',
      to: '2026-11-11',
    })
    expect(location.selectedId).toBe(uuid(5))
    expect(location.unreadable).toEqual([])
    expect(readAuditLocation('?type=%20ASSET_UPDATED%20').filters.eventType).toBe('ASSET_UPDATED')
  })

  it('ignores a day that is not a day and an event id that is not an id, without guessing', () => {
    const location = readAuditLocation('?du=hier&au=2026-02-30&evenement=abc')
    expect(location.filters.from).toBe('')
    expect(location.filters.to).toBe('')
    expect(location.unreadable).toEqual(['from', 'to'])
    expect(location.selectedId).toBeNull()
  })

  it('keeps no filter when the address has none', () => {
    expect(readAuditLocation('')).toEqual({ filters: NO_FILTERS, selectedId: null, unreadable: [] })
  })
})

describe('auditHref', () => {
  it('writes only the filters that are set, then the selected event, and round-trips', () => {
    const filters = { ...NO_FILTERS, eventType: 'COMMAND_SENT', from: '2026-11-10' }
    const href = auditHref(filters, uuid(9))
    expect(href).toBe(`/audit?du=2026-11-10&type=COMMAND_SENT&evenement=${uuid(9)}`)
    expect(readAuditLocation(href.slice('/audit'.length)).filters).toEqual(filters)
    expect(auditHref(NO_FILTERS)).toBe('/audit')
  })
})

describe('toAuditQuery (09 §19.1)', () => {
  it('sends the page size and no filter that is not set', () => {
    expect(toAuditQuery(NO_FILTERS)).toEqual({ limit: AUDIT_PAGE_SIZE })
  })

  it('turns the laboratory days into an inclusive from and an exclusive to, whatever the browser zone', () => {
    // 10 and 11 November 2026 are EST (UTC-5): the day « Au 11 » ends where 12 November begins.
    expect(toAuditQuery({ ...NO_FILTERS, from: '2026-11-10', to: '2026-11-11' })).toMatchObject({ from: '2026-11-10T05:00:00Z', to: '2026-11-12T05:00:00Z' })
  })

  it('follows the clock change: the last day of daylight time ends at the first instant of standard time', () => {
    // 1 November 2026 has 25 hours in America/Toronto: midnight EDT (04:00Z) to midnight EST (05:00Z) of the 2nd.
    expect(toAuditQuery({ ...NO_FILTERS, from: '2026-11-01', to: '2026-11-01' })).toMatchObject({ from: '2026-11-01T04:00:00Z', to: '2026-11-02T05:00:00Z' })
  })

  it('passes the codes and identifiers as typed, for the server to judge', () => {
    expect(toAuditQuery({ ...NO_FILTERS, eventType: 'nope', subjectId: 'zzz' })).toMatchObject({ eventType: 'nope', subjectId: 'zzz' })
  })
})

describe('field helpers', () => {
  it('lists the active fields in form order and narrows server field names to the form', () => {
    expect(activeFilterFields({ ...NO_FILTERS, actorUserId: 'x', from: '2026-11-10' })).toEqual(['from', 'actorUserId'])
    expect(refusedFields(['to', 'limit', 'eventType'])).toEqual(['to', 'eventType'])
  })
})
