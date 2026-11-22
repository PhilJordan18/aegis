import { describe, expect, it } from 'vitest'
import { parseAuditDetails } from './contractParsers'
import { leafRank } from './auditDetailPaths'
import * as sample from './auditDetailSamples'

const keys = (details: unknown) => parseAuditDetails(details).entries.map(([key]) => key)

describe('nested details at allowlisted paths (09 §19.1)', () => {
  it('reads a catalog update as the paths of its from and to leaves, null included', () => {
    const parsed = parseAuditDetails(sample.ASSET_UPDATED_CALIBRATION)
    expect(parsed.omitted).toBe(0)
    expect(Object.fromEntries(parsed.entries)).toEqual({
      'changes.calibrationDueAt.to': '2027-06-30T04:00:00Z',
      'changes.calibrationDueAt.from': null,
      'changes.operationalStatus.to': 'DAMAGED',
      'changes.operationalStatus.from': 'SERVICEABLE',
      'changes.calibrationRequired.to': true,
      'changes.calibrationRequired.from': false,
    })
  })

  it('reads what was created, revoked and assigned', () => {
    expect(keys(sample.ASSET_CREATED_MODEL).sort()).toEqual(['created.defaultCalibrationRequired', 'created.manufacturer', 'created.modelNumber', 'created.name'])
    expect(parseAuditDetails(sample.ASSET_CREATED_UNIT)).toMatchObject({ omitted: 0, entries: expect.arrayContaining([['created.assetCode', 'AEG-DEMO-005'], ['created.calibrationRequired', true]]) })
    expect(Object.fromEntries(parseAuditDetails(sample.ASSET_UPDATED_REVOKED).entries)).toMatchObject({ 'revoked.type': 'RFID_UHF', revokedAt: expect.any(String) })
    expect(keys(sample.ASSET_IDENTIFIER_ASSIGNED).sort()).toEqual(['assigned.assetId', 'assigned.type'])
  })

  it('reads a placement on both sides and ignores a side that is null', () => {
    expect(parseAuditDetails(sample.ASSET_PLACEMENT_MOVED)).toMatchObject({ omitted: 0 })
    expect(keys(sample.ASSET_PLACEMENT_MOVED).filter((key) => key.startsWith('from.')).sort()).toEqual(['from.assignedAt', 'from.compartmentCode', 'from.compartmentId', 'from.lockerCode', 'from.lockerId', 'from.placementId'])
    expect(parseAuditDetails(sample.ASSET_PLACEMENT_FIRST)).toMatchObject({ omitted: 0, entries: expect.not.arrayContaining([expect.arrayContaining(['from'])]) })
    expect(keys(sample.ASSET_PLACEMENT_FIRST).every((key) => key.startsWith('to.'))).toBe(true)
    expect(keys(sample.ASSET_PLACEMENT_ENDED).every((key) => key.startsWith('from.'))).toBe(true)
    expect(parseAuditDetails(sample.ASSET_PLACEMENT_ENDED).omitted).toBe(0)
  })

  it('reads a schedule window by window, with its indices', () => {
    const parsed = parseAuditDetails(sample.SCHEDULE_UPDATED_CHANGED)
    expect(parsed.omitted).toBe(0)
    // 2 x (timeZone + 7 windows x 4 fields) and previousScheduleId at the top level.
    expect(parsed.entries).toHaveLength(2 * (1 + 7 * 4) + 1)
    expect(Object.fromEntries(parsed.entries)).toMatchObject({
      'before.windows[0].closesAt': '18:00:00',
      'after.windows[0].closesAt': '19:30:00',
      'after.windows[5].enabled': false,
      'after.windows[5].opensAt': null,
      'after.timeZone': 'America/Toronto',
    })
    expect(parseAuditDetails(sample.SCHEDULE_UPDATED_FIRST)).toMatchObject({ omitted: 0 })
    expect(keys(sample.SCHEDULE_UPDATED_FIRST).some((key) => key.startsWith('before.'))).toBe(false)
  })

  it('reads a list of identifiers element by element and treats an empty list as nothing', () => {
    expect(parseAuditDetails(sample.RESERVATION_CANCELLED)).toMatchObject({ omitted: 0 })
    expect(keys(sample.RESERVATION_CANCELLED)).toContain('endedOperationIds[1]')
    expect(parseAuditDetails(sample.RESERVATION_EXPIRED_NO_OPERATION)).toEqual({ entries: [['assetId', '116f5db2-227b-4a3f-ac7c-7fd246d4e5a3'], ['reservedUntil', '2026-11-21T20:00:00Z']], omitted: 0 })
  })

  it('does not count an empty container, nor a null where a container may stand', () => {
    expect(parseAuditDetails({ changes: {}, created: {}, to: null, after: { windows: [] } })).toEqual({ entries: [], omitted: 0 })
  })

  it('keeps the flat details exactly as before', () => {
    const flat = { assetId: 'a', attempt: 2, displayInstructionsStopped: true, outcome: null }
    expect(parseAuditDetails(flat)).toEqual({ entries: Object.entries(flat), omitted: 0 })
    expect(parseAuditDetails(null)).toEqual({ entries: [], omitted: 0 })
    expect(parseAuditDetails([1])).toEqual({ entries: [], omitted: 0 })
  })
})

describe('what the allowlist does not name is counted and never read', () => {
  it('drops an unknown key inside a known container, with its value', () => {
    const parsed = parseAuditDetails({ created: { name: 'Fluke', description: 'free text', value: 'E2003412' }, changes: { name: { from: 'a', to: 'b', secret: 'x' } }, revoked: { value: 'E2003412', type: 'NFC' } })
    expect(Object.fromEntries(parsed.entries)).toEqual({ 'created.name': 'Fluke', 'changes.name.from': 'a', 'changes.name.to': 'b', 'revoked.type': 'NFC' })
    expect(parsed.omitted).toBe(4)
  })

  it('drops an unknown container whole and counts it once', () => {
    expect(parseAuditDetails({ payload: { a: { b: 1, c: [1, 2] } }, tokens: [{ x: 1 }], created: { extra: { deep: 1 } }, changes: { unknownField: { from: 1, to: 2 } } })).toEqual({ entries: [], omitted: 4 })
  })

  it('drops a structure where the allowlist expects a scalar, and a scalar where it expects a container', () => {
    const parsed = parseAuditDetails({ created: { name: { nested: 'x' }, manufacturer: ['a'] }, changes: 'x'.repeat(3), after: { windows: [5, 'a'], timeZone: 'America/Toronto' } })
    expect(Object.fromEntries(parsed.entries)).toEqual({ changes: 'xxx', 'after.timeZone': 'America/Toronto' })
    expect(parsed.omitted).toBe(4)
  })

  it('drops a list on a scalar path and a scalar list that is not on the allowlist', () => {
    expect(parseAuditDetails({ assetId: ['a'], messageIds: ['a', 'b'], endedOperationIds: [{ id: 'x' }, 'ok'] })).toEqual({ entries: [['endedOperationIds[1]', 'ok']], omitted: 3 })
  })

  it('never takes a prototype key for a path', () => {
    const parsed = parseAuditDetails(JSON.parse('{"__proto__":{"polluted":1},"created":{"__proto__":"x","constructor":"y","name":"ok"},"constructor":"z"}'))
    expect(Object.fromEntries(parsed.entries)).toEqual(JSON.parse('{"constructor":"z","created.name":"ok"}'))
    expect(parsed.omitted).toBe(3)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('counts a number that is not finite', () => {
    expect(parseAuditDetails({ attempt: Number.POSITIVE_INFINITY, created: { name: 'x' } })).toEqual({ entries: [['created.name', 'x']], omitted: 1 })
  })

  it('bounds depth, list length and the number of leaves', () => {
    let deep: unknown = 'leaf'
    for (let level = 0; level < 50; level += 1) deep = { after: deep }
    expect(parseAuditDetails(deep)).toEqual({ entries: [], omitted: 1 })

    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`)
    const longList = parseAuditDetails({ endedOperationIds: ids })
    expect(longList.entries).toHaveLength(100)
    expect(longList.omitted).toBe(150)

    const windows = Array.from({ length: 100 }, () => ({ dayOfWeek: 'MONDAY', enabled: true, opensAt: '07:00:00', closesAt: '18:00:00' }))
    const manyLeaves = parseAuditDetails({ before: { windows }, after: { windows } })
    expect(manyLeaves.entries).toHaveLength(200)
    expect(manyLeaves.omitted).toBe(600)
  })
})

describe('reading order', () => {
  it('ranks an allowlisted path by its place in the list, whatever the list position', () => {
    expect(leafRank('changes.name.from')).toBeLessThan(leafRank('changes.name.to'))
    expect(leafRank('after.windows[6].opensAt')).toBe(leafRank('after.windows[0].opensAt'))
    expect(leafRank('unknown.path')).toBe(-1)
    expect(leafRank('assetId')).toBe(-1)
  })
})
