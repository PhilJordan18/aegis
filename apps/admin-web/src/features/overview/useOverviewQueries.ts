import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { useAnomalyList } from '../anomalies/useAnomalyQueries'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useAdminLockers } from '../custody/useCustody'
import { useLockerGateway } from '../lockers/LockerGatewayContext'
import { lockerStatusOptions } from '../lockers/useLockerStatus'
import type { LoanStatus, LockerOperationStatus } from '../transactions/contract'
import { useTransactionGateway } from '../transactions/TransactionGatewayContext'
import { IN_PROGRESS_OPERATION_STATUSES, OPEN_LOAN_STATUSES, ROW_LIMIT, WIDE_PAGE_SIZE } from './overviewModel'

/** `GET /admin/anomalies?status=OPEN&page=0&size=100`: `totalItems` is the count, the page is the preview. */
export const OPEN_ANOMALIES_QUERY = { status: 'OPEN', page: 0, size: WIDE_PAGE_SIZE } as const

export function useOpenAnomalies() {
  return useAnomalyList(OPEN_ANOMALIES_QUERY)
}

/** Only the preview is needed: the count is `totalItems`, so a small page is enough. */
export function useActiveReservations() {
  const gateway = useTransactionGateway()
  const session = useSessionStore()
  const query = { status: 'ACTIVE', page: 0, size: ROW_LIMIT } as const
  return useQuery({
    queryKey: queryKeys.overview.reservations(query),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.listReservations(accessToken, query, signal)),
  })
}

/**
 * One read per open status, as wide as the contract allows: §17 has no `overdue` filter, so the overdue loans can only
 * be found by reading the loans and keeping the ones the server flags. The reads stay separate so one failing status
 * does not hide the other.
 */
export function useOpenLoanReads() {
  const gateway = useTransactionGateway()
  const session = useSessionStore()
  return useQueries({
    queries: OPEN_LOAN_STATUSES.map((status: LoanStatus) => {
      const query = { status, page: 0, size: WIDE_PAGE_SIZE } as const
      return {
        queryKey: queryKeys.overview.loans(query),
        queryFn: ({ signal }: { signal: AbortSignal }) => authorizedRequest(session, (accessToken) => gateway.listLoans(accessToken, query, signal)),
      }
    }),
  })
}

/**
 * Operations in progress: §17 takes one `status`, so each non-final status is read on its own, as wide as the contract
 * allows, and the distinct operations observed are counted. Nothing is derived from reservations or loans, so the block
 * depends on no other.
 */
export function useInProgressOperationReads() {
  const gateway = useTransactionGateway()
  const session = useSessionStore()
  return useQueries({
    queries: IN_PROGRESS_OPERATION_STATUSES.map((status: LockerOperationStatus) => {
      const query = { status, page: 0, size: WIDE_PAGE_SIZE } as const
      return {
        queryKey: queryKeys.overview.operations(query),
        queryFn: ({ signal }: { signal: AbortSignal }) => authorizedRequest(session, (accessToken) => gateway.listLockerOperations(accessToken, query, signal)),
      }
    }),
  })
}

/** `GET /admin/lockers`: the lockers to show, with the placement of each cell. */
export function useOverviewLockers() {
  return useAdminLockers()
}

/** One status read per locker, on the cache key and the interval of the Casiers page: the two share their requests. */
export function useLockerStatuses(lockerIds: readonly string[]) {
  const gateway = useLockerGateway()
  const session = useSessionStore()
  return useQueries({ queries: lockerIds.map((lockerId) => lockerStatusOptions(gateway, session, lockerId)) })
}

/** Reads every active query of the page again, the locker statuses included; failures stay on their own block. */
export function refreshOverview(client: QueryClient): Promise<unknown> {
  return Promise.allSettled([
    client.refetchQueries({ queryKey: queryKeys.overview.all, type: 'active' }),
    client.refetchQueries({ queryKey: queryKeys.anomalies.all, type: 'active' }),
    client.refetchQueries({ queryKey: queryKeys.custody.all, type: 'active' }),
    client.refetchQueries({ queryKey: [...queryKeys.lockers.all, 'status'], type: 'active' }),
  ])
}

/** The « Actualiser » button: busy while its own refresh runs, not while a locker status polls. */
export function useOverviewRefresh() {
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  /** Epoch ms at which the last manual refresh ended, for the announcement; null before the first one. */
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const refresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    void refreshOverview(client).finally(() => {
      setRefreshing(false)
      setRefreshedAt(Date.now())
    })
  }, [client, refreshing])
  return { refreshing, refreshedAt, refresh }
}
