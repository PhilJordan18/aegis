import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import type { GatewayResult } from '../auth/authGateway'
import type { LoanStatus, LoanView, LockerOperationStatus, LockerOperationView, ReservationStatus, ReservationView, TransactionPage } from './contract'
import { periodInstants } from './transactionQuery'
import type { TransactionFilterValues, TransactionView } from './transactionHref'
import { useTransactionGateway } from './TransactionGatewayContext'
import { isOperationFollowed, operationRefetchInterval } from './operationPolling'
import { isTerminalOperation } from './transactionPresentation'

/** A record of one of the three lists, tagged so the screen narrows it without a cast. */
export type TransactionRecord =
  | { readonly kind: 'reservations'; readonly item: ReservationView }
  | { readonly kind: 'loans'; readonly item: LoanView }
  | { readonly kind: 'operations'; readonly item: LockerOperationView }

export interface TransactionRecordPage {
  readonly items: readonly TransactionRecord[]
  readonly page: number
  readonly size: number
  readonly totalItems: number
  readonly totalPages: number
}

/** Fixed: the console offers no page size and sends no sort (09 §17 defines none). */
export const TRANSACTION_PAGE_SIZE = 20

function tag<T, R>(result: GatewayResult<T>, map: (value: T) => R): GatewayResult<R> {
  return result.kind === 'ok' ? { ...result, value: map(result.value) } : result
}

function recordsOf<T>(page: TransactionPage<T>, wrap: (item: T) => TransactionRecord): TransactionRecordPage {
  return { ...page, items: page.items.map(wrap) }
}

/**
 * One page of the active list. The previous page stays on screen while the next one of the same view loads; another
 * view starts from its loading state, so a reservation row is never shown, counted or selected as a loan. A status in
 * the address was checked against its view when the address was read, so the casts below only name a value already
 * validated.
 */
export function useTransactionList(view: TransactionView, filters: TransactionFilterValues, page: number) {
  const gateway = useTransactionGateway()
  const session = useSessionStore()
  const common = { assetId: filters.assetId ?? undefined, ...periodInstants(filters), page, size: TRANSACTION_PAGE_SIZE }
  const keyed = { ...common, status: filters.status ?? undefined }
  const key =
    view === 'reservations'
      ? queryKeys.transactions.reservationList(keyed)
      : view === 'loans'
        ? queryKeys.transactions.loanList(keyed)
        : queryKeys.transactions.operationList(keyed)
  return useQuery<TransactionRecordPage, Error, TransactionRecordPage, readonly unknown[]>({
    queryKey: key,
    queryFn: ({ signal }): Promise<TransactionRecordPage> =>
      authorizedRequest(session, async (accessToken): Promise<GatewayResult<TransactionRecordPage>> => {
        if (view === 'reservations') {
          const result = await gateway.listReservations(accessToken, { ...common, status: (filters.status ?? undefined) as ReservationStatus | undefined }, signal)
          return tag(result, (value) => recordsOf(value, (item) => ({ kind: 'reservations', item })))
        }
        if (view === 'loans') {
          const result = await gateway.listLoans(accessToken, { ...common, status: (filters.status ?? undefined) as LoanStatus | undefined }, signal)
          return tag(result, (value) => recordsOf(value, (item) => ({ kind: 'loans', item })))
        }
        const result = await gateway.listLockerOperations(accessToken, { ...common, status: (filters.status ?? undefined) as LockerOperationStatus | undefined }, signal)
        return tag(result, (value) => recordsOf(value, (item) => ({ kind: 'operations', item })))
      }),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === key[1] ? previous : undefined),
  })
}

/**
 * Reads again what an operation that has just become terminal changed (ADR-006): the linked reservation and loan by
 * id, the equipment, and the operation lists. Only queries that are on screen request again; the others are marked
 * stale and read on their next mount. No list is ever polled: this runs once, at the transition.
 */
function refreshAfterTerminal(client: QueryClient, operation: LockerOperationView) {
  void client.invalidateQueries({ queryKey: queryKeys.catalog.asset(operation.assetId) })
  if (operation.reservationId !== null) void client.invalidateQueries({ queryKey: queryKeys.transactions.reservation(operation.reservationId) })
  if (operation.loanId !== null) void client.invalidateQueries({ queryKey: queryKeys.transactions.loan(operation.loanId) })
  void client.invalidateQueries({ queryKey: queryKeys.transactions.operationLists })
}

/**
 * The selected file, read by its id from `GET …/{id}` even when the list holds it (and even when the filters would
 * not): the file is not the row. The list's copy stands in while the request runs; an error still wins.
 *
 * An operation is followed while the server says it can still move (ADR-006): one read about every second with a
 * single request in flight, a doubling delay after each consecutive failure (capped), nothing while the tab is hidden
 * and one immediate read when it is visible again, and nothing once it is terminal or the server refuses (401, 403,
 * 404). Reservations and loans are read once and never followed.
 */
export function useTransactionDetail(view: TransactionView, id: string | null, listed: TransactionRecord | undefined) {
  const gateway = useTransactionGateway()
  const session = useSessionStore()
  const client = useQueryClient()
  const key =
    view === 'reservations'
      ? queryKeys.transactions.reservation(id ?? '')
      : view === 'loans'
        ? queryKeys.transactions.loan(id ?? '')
        : queryKeys.transactions.operation(id ?? '')
  const followed = view === 'operations'
  /** Consecutive failed reads of the operation being followed; the backoff reads it, a success resets it. */
  const failures = useRef({ id: '', count: 0 })
  const query = useQuery<TransactionRecord, Error, TransactionRecord, readonly unknown[]>({
    queryKey: key,
    queryFn: async ({ signal }): Promise<TransactionRecord> => {
      const target = id ?? ''
      const read = (): Promise<TransactionRecord> =>
        authorizedRequest(session, async (accessToken): Promise<GatewayResult<TransactionRecord>> => {
          if (view === 'reservations') return tag(await gateway.getReservation(accessToken, target, signal), (item) => ({ kind: 'reservations', item }))
          if (view === 'loans') return tag(await gateway.getLoan(accessToken, target, signal), (item) => ({ kind: 'loans', item }))
          return tag(await gateway.getLockerOperation(accessToken, target, signal), (item) => ({ kind: 'operations', item }))
        })
      if (!followed) return read()
      if (failures.current.id !== target) failures.current = { id: target, count: 0 }
      try {
        const record = await read()
        failures.current.count = 0
        return record
      } catch (error) {
        // A read cancelled by a newer one (the manual refresh) is not a failure of the service.
        if (!signal.aborted) failures.current.count += 1
        throw error
      }
    },
    enabled: id !== null,
    placeholderData: listed,
    ...(followed && {
      refetchInterval: (polled) => operationRefetchInterval(polled, failures.current.id === id ? failures.current.count : 0),
      // Timers keep running in a hidden tab but TanStack skips the read; coming back must read at once, even a fresh one.
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: (polled) => (isOperationFollowed(polled) ? ('always' as const) : true),
      // The backoff is the retry: once a file is on screen, a failed poll is not retried inside its own request.
      ...(client.getQueryData(key) !== undefined && { retry: false }),
    }),
  })

  const settled = query.isPlaceholderData ? undefined : query.data
  const seen = useRef<{ id: string; terminal: boolean } | null>(null)
  useEffect(() => {
    if (settled === undefined || settled.kind !== 'operations') return
    const terminal = isTerminalOperation(settled.item)
    const before = seen.current
    seen.current = { id: settled.item.id, terminal }
    if (terminal && before !== null && before.id === settled.item.id && !before.terminal) refreshAfterTerminal(client, settled.item)
  }, [settled, client])

  return query
}
