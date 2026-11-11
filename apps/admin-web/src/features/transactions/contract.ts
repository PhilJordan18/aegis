import type { AssetModelSummary, PlacementSummary, Unrecognized } from '../catalog/contract'

/**
 * Read-only administration of reservations and loans (LOAN-01 #48), mirrored from
 * docs/cahier-conception/09-contrats-rest.md §8.3, §8.4, §8.8 and §17. These routes never change a state: there is
 * no complete-loan, confirm-operation or force-return route, and the Manager offers none.
 */

export const RESERVATION_STATUSES = ['ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export const LOAN_STATUSES = ['ACTIVE', 'RETURN_PENDING', 'COMPLETED'] as const
export type LoanStatus = (typeof LOAN_STATUSES)[number]

/** §8.8 `AssetSummary`: no raw RFID value and no readiness. */
export interface AssetSummary {
  readonly id: string
  readonly assetCode: string
  readonly model: AssetModelSummary
  readonly placement: PlacementSummary | null
}

/**
 * §8.3. The holder is only `userId`: the contract adds no display name to this view (remainder of C4,
 * `docs/design/asset-lifecycle/sections.md` §5.3). The client shows the id as such and never looks a name up.
 */
export interface ReservationView {
  readonly id: string
  readonly asset: AssetSummary
  readonly userId: string
  readonly status: ReservationStatus | Unrecognized
  readonly reservedFrom: string
  readonly reservedUntil: string
  readonly createdAt: string
  readonly cancelledAt: string | null
  readonly fulfilledAt: string | null
  readonly expiredAt: string | null
  readonly currentOperationId: string | null
  /** Evaluated for the requester (§8.10); kept for completeness, the read-only console never offers them. */
  readonly availableActions: readonly string[]
}

/**
 * §8.4. `overdue` is computed by the server: an overdue loan stays borrowed, and the client neither derives it
 * from `dueAt` nor treats it as a reason to show the asset available.
 */
export interface LoanView {
  readonly id: string
  readonly asset: AssetSummary
  readonly holderUserId: string
  readonly status: LoanStatus | Unrecognized
  readonly checkedOutAt: string
  readonly dueAt: string
  readonly overdue: boolean
  readonly returnRequestedAt: string | null
  readonly returnedAt: string | null
  readonly checkoutOperationId: string
  /** Set only for a confirmed return (§8.4); a return in progress is followed through `currentOperationId`. */
  readonly returnOperationId: string | null
  readonly currentOperationId: string | null
  readonly availableActions: readonly string[]
}

/** §11.1 envelope; `page` is zero-based. */
export interface TransactionPage<T> {
  readonly items: readonly T[]
  readonly page: number
  readonly size: number
  readonly totalItems: number
  readonly totalPages: number
}

/** §17 common filters. `from` is inclusive and `to` exclusive; both are RFC 3339 instants. */
export interface TransactionFilters<S extends string> {
  readonly status?: S
  readonly assetId?: string
  readonly userId?: string
  readonly from?: string
  readonly to?: string
}

export interface TransactionListQuery<S extends string> extends TransactionFilters<S> {
  readonly page: number
  readonly size: number
}

export type ReservationListQuery = TransactionListQuery<ReservationStatus>
export type LoanListQuery = TransactionListQuery<LoanStatus>
