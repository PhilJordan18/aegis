import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { TransactionListQuery } from './contract'
import { parseLoanPage, parseLoanView, parseReservationPage, parseReservationView } from './contractParsers'
import type { TransactionGateway } from './transactionGateway'

/** §17 query string: only the filters that are set, then the page. No sort is sent: the contract defines none. */
export function transactionSearch<S extends string>({ status, assetId, userId, from, to, page, size }: TransactionListQuery<S>): string {
  const params = new URLSearchParams()
  if (status !== undefined) params.set('status', status)
  if (assetId !== undefined) params.set('assetId', assetId)
  if (userId !== undefined) params.set('userId', userId)
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
  }
}
