import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { LockerOperationListQuery, TransactionListQuery } from './contract'
import { parseLoanPage, parseLoanView, parseLockerOperationPage, parseLockerOperationView, parseReservationPage, parseReservationView } from './contractParsers'
import type { TransactionGateway } from './transactionGateway'

/** §17 query string: only the filters that are set, then the page. No sort is sent: the contract defines none. */
export function transactionSearch<S extends string>({ status, assetId, userId, lockerId, from, to, page, size }: TransactionListQuery<S> & { readonly lockerId?: string }): string {
  const params = new URLSearchParams()
  if (status !== undefined) params.set('status', status)
  if (assetId !== undefined) params.set('assetId', assetId)
  if (userId !== undefined) params.set('userId', userId)
  if (lockerId !== undefined) params.set('lockerId', lockerId)
  if (from !== undefined) params.set('from', from)
  if (to !== undefined) params.set('to', to)
  params.set('page', String(page))
  params.set('size', String(size))
  return params.toString()
}

/** Production adapter of 09 §17 for reservations and loans. */
export function createHttpTransactionGateway(options?: HttpClientOptions): TransactionGateway {
  const http = createHttpClient(options)
  return {
    listReservations(accessToken, query, signal) {
      return http.send({ method: 'GET', path: `/admin/reservations?${transactionSearch(query)}`, accessToken, signal, parse: parseReservationPage })
    },
    getReservation(accessToken, reservationId, signal) {
      return http.send({ method: 'GET', path: `/admin/reservations/${encodeURIComponent(reservationId)}`, accessToken, signal, parse: parseReservationView })
    },
    listLoans(accessToken, query, signal) {
      return http.send({ method: 'GET', path: `/admin/loans?${transactionSearch(query)}`, accessToken, signal, parse: parseLoanPage })
    },
    getLoan(accessToken, loanId, signal) {
      return http.send({ method: 'GET', path: `/admin/loans/${encodeURIComponent(loanId)}`, accessToken, signal, parse: parseLoanView })
    },
    listLockerOperations(accessToken, query: LockerOperationListQuery, signal) {
      return http.send({ method: 'GET', path: `/admin/locker-operations?${transactionSearch(query)}`, accessToken, signal, parse: parseLockerOperationPage })
    },
    getLockerOperation(accessToken, operationId, signal) {
      return http.send({ method: 'GET', path: `/admin/locker-operations/${encodeURIComponent(operationId)}`, accessToken, signal, parse: parseLockerOperationView })
    },
  }
}
