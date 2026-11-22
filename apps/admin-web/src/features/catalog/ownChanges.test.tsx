import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { createQueryClient } from '../../api/serverState'
import { adminProfile } from '../auth/testFixtures'
import { createSessionStore, SessionContext } from '../auth/session'
import { CustodyGatewayContext } from '../custody/CustodyGatewayContext'
import { A1_ID, fakeCustodyGateway, okResult } from '../custody/testFixtures'
import { useCustodyMutations } from '../custody/useCustody'
import { CatalogGatewayContext } from './CatalogGatewayContext'
import { asset, fakeCatalogGateway, MM001, ok } from './testFixtures'
import { useCatalogMutations } from './useCatalogMutations'

/**
 * What the Manager itself changes (#197): the unit reads are read again, and so is every reservation, loan, operation
 * and Vue d'ensemble block that carries a copy of the unit (09 §8.9 summaries: code, model name, placement).
 */
const RESERVATION = queryKeys.transactions.reservation('00000000-0000-4000-8000-000000000001')
const LOAN_LIST = queryKeys.transactions.loanList({ page: 0 })
const OPERATION_LIST = queryKeys.transactions.operationList({ page: 0 })
const OVERVIEW = queryKeys.overview.reservations({ status: 'ACTIVE', page: 0, size: 5 })
const ASSET_LIST = queryKeys.catalog.assetList({ page: 0, size: 20, sort: 'assetCode,asc' })
const ANOMALIES = queryKeys.anomalies.list({ status: 'OPEN', page: 0, size: 100 })

function setup() {
  const client = createQueryClient()
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  const held = [RESERVATION, LOAN_LIST, OPERATION_LIST, OVERVIEW, ASSET_LIST, ANOMALIES]
  for (const key of held) client.setQueryData(key, { held: true })
  const stale = () => held.filter((key) => client.getQueryState(key)?.isInvalidated)
  const wrapper = (catalog: ReturnType<typeof fakeCatalogGateway>, custody: ReturnType<typeof fakeCustodyGateway>) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <SessionContext value={session}>
            <CatalogGatewayContext value={catalog}>
              <CustodyGatewayContext value={custody}>{children}</CustodyGatewayContext>
            </CatalogGatewayContext>
          </SessionContext>
        </QueryClientProvider>
      )
    }
  return { client, stale, wrapper }
}

afterEach(cleanup)

describe('the Manager edits a unit or a model', () => {
  it('a saved unit refreshes the reads that name it, and leaves the anomalies alone', async () => {
    const { stale, wrapper } = setup()
    const catalog = fakeCatalogGateway({ overrides: { updateAsset: async () => ok(asset({ id: MM001.id, assetCode: 'MM-001-BIS' })) } })
    const { result } = renderHook(() => useCatalogMutations(), { wrapper: wrapper(catalog, fakeCustodyGateway()) })
    expect(stale()).toEqual([])
    await act(() => result.current.updateAsset.mutateAsync({ assetId: MM001.id, request: {} as never }))
    expect(stale()).toEqual([RESERVATION, LOAN_LIST, OPERATION_LIST, OVERVIEW, ASSET_LIST])
  })

  it('an archived unit (its availability becomes UNAVAILABLE) does the same', async () => {
    const { stale, wrapper } = setup()
    const catalog = fakeCatalogGateway({ overrides: { archiveAsset: async () => ok(asset({ id: MM001.id, assetCode: 'MM-001', availability: 'UNAVAILABLE', archivedAt: '2026-11-22T04:00:00Z' })) } })
    const { result } = renderHook(() => useCatalogMutations(), { wrapper: wrapper(catalog, fakeCustodyGateway()) })
    await act(() => result.current.archiveAsset.mutateAsync({ assetId: MM001.id, idempotencyKey: 'key-1' }))
    expect(stale()).toEqual([RESERVATION, LOAN_LIST, OPERATION_LIST, OVERVIEW, ASSET_LIST])
  })

  it('a renamed model refreshes them too: their summaries carry its name', async () => {
    const { stale, wrapper } = setup()
    const catalog = fakeCatalogGateway({ overrides: { updateModel: async () => ok({ id: 'm', name: 'Multimètre', manufacturer: null, modelNumber: null, description: null, defaultCalibrationRequired: false, archivedAt: null }) } })
    const { result } = renderHook(() => useCatalogMutations(), { wrapper: wrapper(catalog, fakeCustodyGateway()) })
    await act(() => result.current.updateModel.mutateAsync({ modelId: 'm', request: {} as never }))
    expect(stale()).toEqual([RESERVATION, LOAN_LIST, OPERATION_LIST, OVERVIEW, ASSET_LIST])
  })
})

describe('the Manager places a unit', () => {
  it('refreshes the unit reads and every read that names its placement', async () => {
    const { stale, wrapper } = setup()
    const custody = fakeCustodyGateway({
      setPlacement: async () => okResult({ id: 'p', assetId: MM001.id, lockerId: 'l', lockerCode: 'AEGIS-DEMO-01', compartmentId: A1_ID, compartmentCode: 'A1', assignedAt: '2026-11-22T04:00:00Z', reason: 'test' }),
    })
    const { result } = renderHook(() => useCustodyMutations(MM001.id), { wrapper: wrapper(fakeCatalogGateway(), custody) })
    await act(() => result.current.place.mutateAsync({ compartmentId: A1_ID, reason: 'test' }))
    expect(stale()).toEqual([RESERVATION, LOAN_LIST, OPERATION_LIST, OVERVIEW, ASSET_LIST])
  })
})
