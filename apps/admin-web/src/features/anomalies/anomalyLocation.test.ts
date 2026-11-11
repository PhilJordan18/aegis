import { describe, expect, it } from 'vitest'
import { anomaliesHref, hasActiveFilter, NO_FILTERS, readAnomalyLocation } from './anomalyLocation'
import { countGraphemes, isBlank } from './noteLength'
import { parseAnomalyDetail } from './contractParsers'
import { anomalyView, OBSERVATION_ID, OPERATION_ID } from './testFixtures'

const ID = '8a9b0c1d-2e3f-4a5b-9c6d-7e8f9a0b1c2d'

describe('anomaly address', () => {
  it('defaults to « Ouvertes » and to every status when an anomaly is named', () => {
    expect(readAnomalyLocation('').filters.status).toBe('OPEN')
    expect(readAnomalyLocation(`?anomalie=${ID.toUpperCase()}`)).toEqual({ filters: NO_FILTERS, page: 0, anomalyId: ID })
    expect(readAnomalyLocation(`?anomalie=${ID}&statut=ouvertes`).filters.status).toBe('OPEN')
    expect(readAnomalyLocation('?statut=toutes').filters.status).toBeNull()
  })

  it('ignores unusable values', () => {
    expect(readAnomalyLocation('?statut=x&gravite=y&type=z&page=0&anomalie=nope')).toEqual({ filters: { status: 'OPEN', severity: null, type: null }, page: 0, anomalyId: null })
    expect(readAnomalyLocation('?page=99999999999').page).toBe(0)
  })

  it('round-trips through the address', () => {
    for (const location of [
      { filters: { status: 'OPEN', severity: null, type: null }, page: 0, anomalyId: null },
      { filters: { status: null, severity: 'HIGH', type: 'COMMAND_REJECTED' }, page: 2, anomalyId: null },
      { filters: { status: 'OPEN', severity: null, type: null }, page: 0, anomalyId: ID },
      { filters: { status: 'ACKNOWLEDGED', severity: 'LOW', type: null }, page: 1, anomalyId: ID },
      { filters: NO_FILTERS, page: 0, anomalyId: ID },
    ] as const) {
      expect(readAnomalyLocation(anomaliesHref(location).split('?')[1] ?? '')).toEqual(location)
    }
    expect(anomaliesHref({ filters: { status: 'OPEN', severity: null, type: null }, page: 0, anomalyId: null })).toBe('/anomalies')
  })

  it('treats « Ouvertes » as a filter, so an empty list under it never says there is no record', () => {
    expect(hasActiveFilter({ status: 'OPEN', severity: null, type: null })).toBe(true)
    expect(hasActiveFilter(NO_FILTERS)).toBe(false)
  })
})

describe('note length (indicative only)', () => {
  it('counts graphemes, not UTF-16 units, and flags blank text only', () => {
    expect(countGraphemes('é', 'fr')).toBe(1)
    expect(countGraphemes('é', 'fr')).toBe(1)
    expect(countGraphemes('👩🏽‍🔧', 'fr')).toBe(1)
    expect(countGraphemes('', 'fr')).toBe(0)
    expect(isBlank(' \n\t ')).toBe(true)
    expect(isBlank(' a ')).toBe(false)
  })
})

describe('parseAnomalyDetail evidence (read leniently)', () => {
  const item = { observationId: OBSERVATION_ID, type: 'DOOR_CLOSED', compartmentId: null, operationId: OPERATION_ID, observedAt: '2026-11-10T19:01:00Z', receivedAt: '2026-11-10T19:01:02Z' }

  it('keeps readable entries, counts unreadable ones, and ignores extra members', () => {
    const parsed = parseAnomalyDetail({ ...anomalyView(), evidence: [{ ...item, rawPayload: 'ignored' }, { type: 'x' }, 'text', null] })
    expect(parsed?.evidence?.items).toEqual([item])
    expect(parsed?.evidence?.unreadable).toBe(3)
    expect(JSON.stringify(parsed)).not.toContain('ignored')
  })

  it('does not fail the anomaly when the section is absent or not a list', () => {
    expect(parseAnomalyDetail(anomalyView())?.evidence).toBeNull()
    expect(parseAnomalyDetail({ ...anomalyView(), evidence: { a: 1 } })?.evidence).toBeNull()
    expect(parseAnomalyDetail({ ...anomalyView(), evidence: [] })?.evidence).toEqual({ items: [], unreadable: 0 })
  })

  it('keeps the raw type code and still rejects a broken anomaly', () => {
    expect(parseAnomalyDetail({ ...anomalyView({ type: 'NEW_KIND' }), evidence: [] })?.typeCode).toBe('NEW_KIND')
    expect(parseAnomalyDetail({ ...anomalyView({ summary: '' }), evidence: [] })).toBeNull()
  })
})
