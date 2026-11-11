import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import type { GatewayResult } from '../auth/authGateway'
import type { LoanStatus, LoanView, LockerOperationStatus, LockerOperationView, ReservationStatus, ReservationView, TransactionPage } from './contract'
import { periodInstants } from './transactionQuery'
import type { TransactionFilterValues, TransactionView } from './transactionHref'
import { useTransactionGateway } from './TransactionGatewayContext'

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
 * One page of the active list. The previous page stays on screen while the next one loads. A status in the address
 * was checked against its view when the address was read, so the casts below only name a value already validated.
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
    placeholderData: keepPreviousData,
  })
}

/**
 * The selected file, read by its id from `GET …/{id}` even when the list holds it (and even when the filters would
 * not): the file is not the row. The list's copy stands in while the request runs; an error still wins.
 */
export function useTransactionDetail(view: TransactionView, id: string | null, listed: TransactionRecord | undefined) {
  const gateway = useTransactionGateway()
  const session = useSessionStore()
  const key =
    view === 'reservations'
      ? queryKeys.transactions.reservation(id ?? '')
      : view === 'loans'
        ? queryKeys.transactions.loan(id ?? '')
        : queryKeys.transactions.operation(id ?? '')
  return useQuery<TransactionRecord, Error, TransactionRecord, readonly unknown[]>({
    queryKey: key,
    queryFn: ({ signal }): Promise<TransactionRecord> =>
      authorizedRequest(session, async (accessToken): Promise<GatewayResult<TransactionRecord>> => {
        const target = id ?? ''
        if (view === 'reservations') return tag(await gateway.getReservation(accessToken, target, signal), (item) => ({ kind: 'reservations', item }))
        if (view === 'loans') return tag(await gateway.getLoan(accessToken, target, signal), (item) => ({ kind: 'loans', item }))
        return tag(await gateway.getLockerOperation(accessToken, target, signal), (item) => ({ kind: 'operations', item }))
      }),
    enabled: id !== null,
    placeholderData: listed,
  })
}
