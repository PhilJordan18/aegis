import type { AssetModelSummary, PlacementSummary, Unrecognized } from '../catalog/contract'

/**
 * Read-only administration of reservations, loans and locker operations (LOAN-01 #48), mirrored from
 * docs/cahier-conception/09-contrats-rest.md §8.3, §8.4, §8.5, §8.8 and §17. These routes never change a state: there is
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

/** §8.5 `LockerOperationStatus` (document 05 §5). A command acknowledgement is not proof of unlocking or opening. */
export const LOCKER_OPERATION_STATUSES = [
  'REQUESTED',
  'AWAITING_LOCAL_PROOF',
  'AUTHORIZED',
  'COMMAND_SENT',
  'COMMAND_ACKNOWLEDGED',
  'DOOR_OPENED',
  'OBSERVATION_RECEIVED',
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
  'ANOMALY',
] as const
export type LockerOperationStatus = (typeof LOCKER_OPERATION_STATUSES)[number]

/** Statuses after which an operation cannot move any more (document 05 §5). */
export const TERMINAL_OPERATION_STATUSES: readonly LockerOperationStatus[] = ['CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY']

export const LOCKER_OPERATION_TYPES = ['CHECKOUT', 'RETURN'] as const
export type LockerOperationType = (typeof LOCKER_OPERATION_TYPES)[number]

export const REQUIRED_ACTIONS = ['SCAN_HUB_QR', 'WAIT', 'NONE'] as const
export type RequiredAction = (typeof REQUIRED_ACTIONS)[number]

/**
 * §8.5. Every step is the instant the server sent, or null: the console never infers a missing step from a later
 * one. It carries ids only (user, asset, locker, compartment): no display name and no code. The local access
 * challenge is an id and instants, never its token or payload. `failureReason` is free server text, shown as a
 * technical detail and never as the primary label (G12).
 */
export interface LockerOperationView {
  readonly id: string
  readonly type: LockerOperationType | Unrecognized
  readonly status: LockerOperationStatus | Unrecognized
  readonly userId: string
  readonly assetId: string
  readonly lockerId: string
  readonly compartmentId: string
  readonly reservationId: string | null
  readonly loanId: string | null
  readonly createdAt: string
  readonly authorizedAt: string | null
  readonly localAccessChallengeId: string | null
  readonly localProofExpiresAt: string | null
  readonly localProofDisplayedAt: string | null
  readonly localProofValidatedAt: string | null
  readonly requiredAction: RequiredAction | Unrecognized
  readonly expiresAt: string | null
  readonly commandSentAt: string | null
  readonly acknowledgedAt: string | null
  readonly doorOpenedAt: string | null
  readonly observationReceivedAt: string | null
  readonly confirmedAt: string | null
  readonly terminalAt: string | null
  readonly failureReason: string | null
  readonly anomalyId: string | null
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
/** `lockerId` is a §17 filter of the operations only. */
export type LockerOperationListQuery = TransactionListQuery<LockerOperationStatus> & { readonly lockerId?: string }
