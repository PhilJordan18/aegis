import { describe, expect, it } from 'vitest'
import { MM001, MM002, asset, pageOf } from '../catalog/testFixtures'
import type { AdminLockerPage } from '../custody/contract'
import { abbreviate, assetPagesToRead, buildLabelIndex } from './labelIndex'

const LOCKER_ID = '11111111-1111-4111-8111-111111111111'
const A1 = '22222222-2222-4222-8222-222222222222'
const A2 = '33333333-3333-4333-8333-333333333333'
const OFF_INDEX = '44444444-4444-4444-8444-444444444444'

const lockers = (currentAsset: { id: string; assetCode: string } | null = null): AdminLockerPage => ({
  items: [
    {
      id: LOCKER_ID,
      code: 'AEGIS-DEMO-01',
      name: 'Démo',
      topology: 'GRID',
      compartments: [
        { id: A1, code: 'A1', enabled: true, currentAsset },
        { id: A2, code: 'A2', enabled: true, currentAsset: null },
      ],
    },
  ],
  page: 0,
  size: 100,
  totalItems: 1,
  totalPages: 1,
})

const ok = <T,>(data: T) => ({ data, failed: false })
const pending = { data: undefined, failed: false }
const failed = { data: undefined, failed: true }

describe('buildLabelIndex', () => {
  it('names a unit by its own id and a cell by its own id', () => {
    const index = buildLabelIndex({ lockers: ok(lockers()), assets: [ok(pageOf([MM001, MM002]))] })
    expect(index.health).toBe('ready')
    expect(index.asset(MM002.id)).toEqual({ kind: 'known', code: 'MM-002', modelName: 'Multimètre 2', archived: false })
    expect(index.compartment(A2)).toEqual({ kind: 'known', code: 'A2', lockerCode: 'AEGIS-DEMO-01' })
    expect(index.locker(LOCKER_ID)).toEqual({ kind: 'known', code: 'AEGIS-DEMO-01' })
  })

  it('never infers a unit from what a cell holds now (contradictory placement)', () => {
    // A1 now holds MM-001; a past fact on A1 about MM-002 still reads MM-002.
    const index = buildLabelIndex({ lockers: ok(lockers({ id: MM001.id, assetCode: 'MM-001' })), assets: [ok(pageOf([MM002]))] })
    expect(index.asset(MM002.id)).toMatchObject({ code: 'MM-002' })
    expect(index.asset(OFF_INDEX)).toEqual({ kind: 'unknown' })
  })

  it('falls back to the code a cell carries for that same unit when the unit pages failed', () => {
    const index = buildLabelIndex({ lockers: ok(lockers({ id: MM001.id, assetCode: 'MM-001' })), assets: [failed] })
    expect(index.health).toBe('partial')
    expect(index.asset(MM001.id)).toEqual({ kind: 'known', code: 'MM-001', modelName: null, archived: false })
  })

  it('marks archived units', () => {
    const archived = asset({ id: OFF_INDEX, assetCode: 'OLD-1', archivedAt: '2026-10-01T00:00:00Z' })
    const index = buildLabelIndex({ lockers: ok(lockers()), assets: [ok(pageOf([archived]))] })
    expect(index.asset(OFF_INDEX)).toMatchObject({ archived: true })
  })

  it('is pending while a read runs, failed when nothing could be read, partial beyond 500 units', () => {
    expect(buildLabelIndex({ lockers: pending, assets: [ok(pageOf([]))] }).health).toBe('pending')
    expect(buildLabelIndex({ lockers: ok(lockers()), assets: [pending] }).asset(MM001.id)).toEqual({ kind: 'pending' })
    expect(buildLabelIndex({ lockers: failed, assets: [failed] }).health).toBe('failed')
    const big = pageOf([MM001], { totalItems: 501, totalPages: 6 })
    expect(buildLabelIndex({ lockers: ok(lockers()), assets: [ok(big)] }).health).toBe('partial')
  })
})

describe('assetPagesToRead', () => {
  it('reads one page first, then at most five', () => {
    expect(assetPagesToRead(undefined)).toBe(1)
    expect(assetPagesToRead(pageOf([], { totalPages: 0 }))).toBe(1)
    expect(assetPagesToRead(pageOf([], { totalPages: 3 }))).toBe(3)
    expect(assetPagesToRead(pageOf([], { totalPages: 9 }))).toBe(5)
  })
})

it('abbreviates to eight characters', () => {
  expect(abbreviate('6c0d7d3e-aaaa-4bbb-8ccc-dddddddddddd')).toBe('6c0d7d3e…')
})
