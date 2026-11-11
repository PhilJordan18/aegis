import type { GatewayResult } from '../auth/authGateway'
import type { LoanListQuery, LoanView, LockerOperationListQuery, LockerOperationView, ReservationListQuery, ReservationView, TransactionPage } from './contract'

/** Boundary of the read-only administration routes of 09 §17 (reservations, loans and locker operations). */
export interface TransactionGateway {
  /** `GET /api/v1/admin/reservations?status&assetId&userId&from&to&page&size`. */
  listReservations(accessToken: string, query: ReservationListQuery, signal?: AbortSignal): Promise<GatewayResult<TransactionPage<ReservationView>>>
  /** `GET /api/v1/admin/reservations/{reservationId}`. */
  getReservation(accessToken: string, reservationId: string, signal?: AbortSignal): Promise<GatewayResult<ReservationView>>
  /** `GET /api/v1/admin/loans?status&assetId&userId&from&to&page&size`. */
  listLoans(accessToken: string, query: LoanListQuery, signal?: AbortSignal): Promise<GatewayResult<TransactionPage<LoanView>>>
  /** `GET /api/v1/admin/loans/{loanId}`. */
  getLoan(accessToken: string, loanId: string, signal?: AbortSignal): Promise<GatewayResult<LoanView>>
  /** `GET /api/v1/admin/locker-operations?status&assetId&userId&lockerId&from&to&page&size`. */
  listLockerOperations(accessToken: string, query: LockerOperationListQuery, signal?: AbortSignal): Promise<GatewayResult<TransactionPage<LockerOperationView>>>
  /** `GET /api/v1/admin/locker-operations/{operationId}`. */
  getLockerOperation(accessToken: string, operationId: string, signal?: AbortSignal): Promise<GatewayResult<LockerOperationView>>
}

const notConfigured = async () => ({ kind: 'network', reason: 'notConfigured' }) as const

export const unconfiguredTransactionGateway: TransactionGateway = {
  listReservations: notConfigured,
  getReservation: notConfigured,
  listLoans: notConfigured,
  getLoan: notConfigured,
  listLockerOperations: notConfigured,
  getLockerOperation: notConfigured,
}
