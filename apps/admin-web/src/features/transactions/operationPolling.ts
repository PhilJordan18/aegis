import type { Query } from '@tanstack/react-query'
import { ApiRequestError, SessionEndedError } from '../../api/serverState'
import { UNRECOGNIZED } from '../catalog/contract'
import { isTerminalOperation } from './transactionPresentation'
import type { TransactionRecord } from './useTransactionQueries'

/**
 * ADR-006 follow-up of the open operation dossier: `GET /admin/locker-operations/{id}` about every second while the
 * operation can still move. These helpers are pure so the cadence is testable without a screen.
 */
export const OPERATION_POLL_MS = 1_000
/** Ceiling of the backoff: a failing service is asked again every 15 s at most, never faster. */
export const OPERATION_POLL_MAX_MS = 15_000

/** 1 s after a success, then 2 s, 4 s, 8 s and 15 s after each consecutive failure. */
export function operationPollDelay(consecutiveFailures: number): number {
  return Math.min(OPERATION_POLL_MS * 2 ** Math.max(consecutiveFailures, 0), OPERATION_POLL_MAX_MS)
}

/**
 * A refusal that asking again cannot change: the session ended, or a 4xx other than 408 and 429 (401, 403, 404 among
 * them; 09 §21 treats 4xx answers as authoritative). Transport failures, 5xx, 408 and 429 are worth another try.
 */
export function isAuthoritativeFailure(error: unknown): boolean {
  if (error instanceof SessionEndedError) return true
  if (!(error instanceof ApiRequestError) || error.failure.kind !== 'httpProblem') return false
  const { status } = error.failure
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

type FollowedQuery = Pick<Query<TransactionRecord, Error, TransactionRecord, readonly unknown[]>, 'state'>

/**
 * Whether the dossier keeps following this operation. Only a record the server itself returned counts: the list's
 * copy standing in during the first read never starts a poll. A status this client does not know is not known to be
 * non-terminal, so it is read once and left alone.
 */
export function isOperationFollowed(query: FollowedQuery): boolean {
  const data = query.state.data
  if (data === undefined || data.kind !== 'operations') return false
  if (isTerminalOperation(data.item) || data.item.status === UNRECOGNIZED) return false
  return !(query.state.status === 'error' && isAuthoritativeFailure(query.state.error))
}

/** TanStack `refetchInterval`: the delay before the next read, or `false` to stop. */
export function operationRefetchInterval(query: FollowedQuery, consecutiveFailures: number): number | false {
  return isOperationFollowed(query) ? operationPollDelay(consecutiveFailures) : false
}
