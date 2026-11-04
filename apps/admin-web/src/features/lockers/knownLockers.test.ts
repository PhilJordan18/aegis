import { describe, expect, it } from 'vitest'
import { asset, MM001, MM002 } from '../catalog/testFixtures'
import { lockerIdFromSearch, lockerIdsFromPlacements } from './knownLockers'
import { DEMO_LOCKER_ID } from './testFixtures'

const placement = (lockerId: string, compartmentCode: string) => ({ lockerId, lockerCode: 'AEGIS-DEMO-01', compartmentId: `c-${compartmentCode}`, compartmentCode })

describe('lockerIdFromSearch', () => {
  it('reads a UUID, lower-cased', () => {
    expect(lockerIdFromSearch(`?casier=${DEMO_LOCKER_ID.toUpperCase()}`)).toBe(DEMO_LOCKER_ID)
  })

  it.each(['', '?casier=', '?casier=../auth/me', '?casier=1', `?casier=${DEMO_LOCKER_ID}x`, '?autre=oui'])('ignores %j', (search) => {
    expect(lockerIdFromSearch(search)).toBeNull()
  })
})

describe('lockerIdsFromPlacements', () => {
  it('lists each placed locker once, in the order the units come', () => {
    const other = '11111111-2222-4333-8444-555555555555'
    const units = [
      { ...MM001, placement: placement(DEMO_LOCKER_ID, 'A1') },
      asset({ id: 'a', assetCode: 'X-1' }),
      { ...MM002, placement: placement(DEMO_LOCKER_ID, 'A2') },
      asset({ id: 'b', assetCode: 'X-2', placement: placement(other, 'B1') }),
    ]
    expect(lockerIdsFromPlacements(units)).toEqual([DEMO_LOCKER_ID, other])
  })

  it('finds nothing when no unit is placed', () => {
    expect(lockerIdsFromPlacements([MM001, MM002])).toEqual([])
    expect(lockerIdsFromPlacements([])).toEqual([])
  })
})
