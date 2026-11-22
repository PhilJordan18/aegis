import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { OPEN_ANOMALIES_QUERY } from '../features/overview/useOverviewQueries'
import { refreshAssetSummaries, refreshCustodyFacts } from './invalidation'
import { queryKeys } from './queryKeys'

const ID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

/** One cached read of every family a screen can hold, none of them observed. */
function held() {
  const keys = {
    assetList: queryKeys.catalog.assetList({ page: 0, size: 20, sort: 'assetCode,asc' }),
    assetDossier: queryKeys.catalog.asset(ID),
    modelList: queryKeys.catalog.modelList({ page: 0, size: 20 }),
    reservationList: queryKeys.transactions.reservationList({ page: 0 }),
    reservation: queryKeys.transactions.reservation(ID),
    loanList: queryKeys.transactions.loanList({ page: 0 }),
    loan: queryKeys.transactions.loan(ID),
    operationList: queryKeys.transactions.operationList({ page: 0 }),
    operation: queryKeys.transactions.operation(ID),
    otherOperation: queryKeys.transactions.operation(OTHER),
    overviewReservations: queryKeys.overview.reservations({ status: 'ACTIVE' }),
    overviewLoans: queryKeys.overview.loans({ status: 'ACTIVE' }),
    overviewOperations: queryKeys.overview.operations({ status: 'DOOR_OPENED' }),
    overviewAnomalies: queryKeys.anomalies.list(OPEN_ANOMALIES_QUERY),
    anomalyDossier: queryKeys.anomalies.detail(ID),
    profile: queryKeys.auth.currentProfile(),
    audit: queryKeys.audit.timeline({}),
  }
  const client = new QueryClient()
  for (const key of Object.values(keys)) client.setQueryData(key, { held: true })
  const stale = () => Object.entries(keys).filter(([, key]) => client.getQueryState(key)?.isInvalidated).map(([name]) => name)
  return { client, stale }
}

describe('refreshCustodyFacts', () => {
  it('marks stale every read that shows availability, a reservation, a loan, an operation or an anomaly, and nothing else', () => {
    const { client, stale } = held()
    refreshCustodyFacts(client)
    expect(stale()).toEqual([
      'assetList',
      'assetDossier',
      'reservationList',
      'reservation',
      'loanList',
      'loan',
      'operationList',
      'operation',
      'otherOperation',
      'overviewReservations',
      'overviewLoans',
      'overviewOperations',
      'overviewAnomalies',
      'anomalyDossier',
    ])
  })

  it('keeps the one read it is told to, so the followed operation is not asked again by its own terminal state', () => {
    const { client, stale } = held()
    refreshCustodyFacts(client, { except: queryKeys.transactions.operation(ID) })
    expect(stale()).not.toContain('operation')
    expect(stale()).toContain('otherOperation')
  })
})

describe('refreshAssetSummaries', () => {
  it('marks stale the reads that carry a copy of a unit (reservations, loans, operations, overview), not the unit reads themselves', () => {
    const { client, stale } = held()
    refreshAssetSummaries(client)
    expect(stale()).toEqual(['reservationList', 'reservation', 'loanList', 'loan', 'operationList', 'operation', 'otherOperation', 'overviewReservations', 'overviewLoans', 'overviewOperations'])
  })
})

describe("the Vue d'ensemble anomaly block", () => {
  it('lives under the anomalies prefix, so an acknowledgement (which invalidates it) refreshes the count too', () => {
    expect(queryKeys.anomalies.list(OPEN_ANOMALIES_QUERY).slice(0, queryKeys.anomalies.all.length)).toEqual([...queryKeys.anomalies.all])
  })
})
