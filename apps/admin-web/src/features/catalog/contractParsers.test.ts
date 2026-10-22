import { describe, expect, it } from 'vitest'
import { parseAdminAssetPage, parseAdminAssetView } from './contractParsers'
import { MM001, MM002, pageOf } from './testFixtures'

describe('parseAdminAssetView', () => {
  it('reads the documented shape, with no readiness', () => {
    const parsed = parseAdminAssetView(JSON.parse(JSON.stringify(MM001)))
    expect(parsed).toEqual(MM001)
    expect(parsed).not.toHaveProperty('readiness')
  })

  it('does not copy a readiness field a server might add', () => {
    expect(parseAdminAssetView({ ...MM001, readiness: { result: 'READY' } })).not.toHaveProperty('readiness')
  })

  it('keeps a placement when the server sends one', () => {
    const placement = { lockerId: 'l1', lockerCode: 'AEGIS-DEMO-01', compartmentId: 'c1', compartmentCode: 'A2' }
    expect(parseAdminAssetView({ ...MM001, placement })?.placement).toEqual(placement)
  })

  it.each([
    ['a missing id', { ...MM001, id: undefined }],
    ['an unknown operational status', { ...MM001, operationalStatus: 'RETIRED' }],
    ['an unknown availability', { ...MM001, availability: 'READY' }],
    ['an unknown presence', { ...MM001, presence: 'SOMEWHERE' }],
    ['an unknown reason', { ...MM001, operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: ['ACCESS_DENIED'] } }],
    ['reasons that are not a list', { ...MM001, operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: 'NOT_PRESENT' } }],
    ['a missing diagnostic', { ...MM001, operationalDiagnostic: undefined }],
    ['a calibration without a status', { ...MM001, calibration: { required: true, dueAt: null } }],
    ['a model without a name', { ...MM001, model: { id: 'm1', name: '', manufacturer: null, modelNumber: null } }],
    ['a broken placement', { ...MM001, placement: { lockerCode: 'X' } }],
    ['a serial number that is not text', { ...MM001, serialNumber: 12 }],
    ['not an object', 'MM-001'],
  ])('rejects %s', (_label, body) => {
    expect(parseAdminAssetView(body)).toBeNull()
  })
})

describe('parseAdminAssetPage', () => {
  it('reads the envelope and each item', () => {
    const page = pageOf([MM001, MM002], { totalItems: 45, totalPages: 3, page: 1 })
    expect(parseAdminAssetPage(JSON.parse(JSON.stringify(page)))).toEqual(page)
  })

  it('accepts an empty page', () => {
    expect(parseAdminAssetPage({ items: [], page: 0, size: 20, totalItems: 0, totalPages: 0 })?.items).toEqual([])
  })

  it.each([
    ['one malformed item', { items: [MM001, { id: 'x' }], page: 0, size: 20, totalItems: 2, totalPages: 1 }],
    ['a negative total', { items: [], page: 0, size: 20, totalItems: -1, totalPages: 0 }],
    ['a fractional page', { items: [], page: 0.5, size: 20, totalItems: 0, totalPages: 0 }],
    ['items that are not a list', { items: {}, page: 0, size: 20, totalItems: 0, totalPages: 0 }],
  ])('rejects %s', (_label, body) => {
    expect(parseAdminAssetPage(body)).toBeNull()
  })
})
