import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAdminAssetPage, parseAdminAssetView } from './contractParsers'
import { MM001, MM002, pageOf } from './testFixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

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
    ['an operational status that is not text', { ...MM001, operationalStatus: 5 }],
    ['an empty availability', { ...MM001, availability: '' }],
    ['a presence that is missing', { ...MM001, presence: undefined }],
    ['a reason that is not text', { ...MM001, operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: [null] } }],
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

describe('unknown enumeration values (09 §3)', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('keeps the unit and marks one unknown reason, logging the field and no server text', () => {
    const spy = warn()
    const parsed = parseAdminAssetView({ ...MM001, operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: ['UNKNOWN_PHYSICAL_STATE', 'QUARANTINED_BY_SERVER'] } })
    expect(parsed?.operationalDiagnostic.reasons).toEqual(['UNKNOWN_PHYSICAL_STATE', 'UNRECOGNIZED'])
    expect(parsed?.assetCode).toBe('MM-001')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]?.[0])).toContain('operationalDiagnostic.reasons')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('QUARANTINED_BY_SERVER')
  })

  it('keeps the unit and marks one unknown operational status', () => {
    const spy = warn()
    const parsed = parseAdminAssetView({ ...MM001, operationalStatus: 'RETIRED' })
    expect(parsed?.operationalStatus).toBe('UNRECOGNIZED')
    expect(parsed?.availability).toBe('AVAILABLE')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('RETIRED')
  })

  it.each([
    ['availability', { availability: 'READY' }],
    ['presence', { presence: 'SOMEWHERE' }],
    ['requiredAccessLevel', { requiredAccessLevel: 'ROOT' }],
  ])('marks an unknown %s and never maps it to a known value', (field, change) => {
    warn()
    const parsed = parseAdminAssetView({ ...MM001, ...change })
    expect(parsed?.[field as 'availability']).toBe('UNRECOGNIZED')
  })

  it('marks an unknown calibration status', () => {
    warn()
    expect(parseAdminAssetView({ ...MM001, calibration: { required: true, dueAt: null, status: 'WAIVED' } })?.calibration.status).toBe('UNRECOGNIZED')
  })

  it('still renders the other units of a page', () => {
    warn()
    const page = parseAdminAssetPage({ items: [{ ...MM001, availability: 'LOST' }, MM002], page: 0, size: 20, totalItems: 2, totalPages: 1 })
    expect(page?.items.map((unit) => unit.assetCode)).toEqual(['MM-001', 'MM-002'])
    expect(page?.items[0]?.availability).toBe('UNRECOGNIZED')
    expect(page?.items[1]?.availability).toBe('AVAILABLE')
  })

  it('does not log for known values', () => {
    const spy = warn()
    parseAdminAssetView(MM002)
    expect(spy).not.toHaveBeenCalled()
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
