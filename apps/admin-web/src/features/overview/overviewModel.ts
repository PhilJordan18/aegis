import { UNRECOGNIZED } from '../catalog/contract'
import type { AnomalyView } from '../anomalies/contract'
import type { AdminLockerPage } from '../custody/contract'
import { classifyTransactionFailure, type TransactionFailure } from '../transactions/transactionFailure'
import { isShownOverdue } from '../transactions/transactionPresentation'
import { LOCKER_OPERATION_STATUSES, TERMINAL_OPERATION_STATUSES, type LoanStatus, type LoanView, type LockerOperationStatus, type LockerOperationView, type TransactionPage } from '../transactions/contract'

/**
 * The Vue d'ensemble reads one route per question and keeps every block independent (#159). Nothing here counts a page
 * as a population: a count read in one request is the server's `totalItems`; a count gathered over several requests is
 * the number of distinct rows observed, and says so. `overdue` is the server's boolean, never derived from `dueAt`, and
 * no readiness is computed.
 */

/** Rows previewed in a block; the page behind the « Voir … » link holds the whole list. */
export const ROW_LIMIT = 5

/** 09 §11.1 and PageQuery: `size` is 1 to 100. Anomalies, loans and operations are read as wide as the contract allows. */
export const WIDE_PAGE_SIZE = 100

/** Statuses read for the overdue loans: §17 takes one `status` per request and has no `overdue` filter. */
export const OPEN_LOAN_STATUSES = ['ACTIVE', 'RETURN_PENDING'] as const satisfies readonly LoanStatus[]

/** The non-final operation statuses (document 05 §5), one read each since §17 takes one `status` per request. */
export const IN_PROGRESS_OPERATION_STATUSES: readonly LockerOperationStatus[] = LOCKER_OPERATION_STATUSES.filter((status) => !TERMINAL_OPERATION_STATUSES.includes(status))

/** What one block knows about its read. `failed` means nothing usable is on screen: it is never a zero. */
export type BlockRead<T> =
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed'; readonly failure: TransactionFailure }
  | { readonly kind: 'ready'; readonly value: T; /** Epoch ms of the read the data comes from. */ readonly readAt: number; /** A refresh failed; the data is the previous read. */ readonly stale: boolean }

interface QueryLike<T> {
  readonly data: T | undefined
  readonly error: Error | null
  readonly isError: boolean
  readonly isRefetchError: boolean
  readonly dataUpdatedAt: number
}

/**
 * A refresh the server refuses (403) leaves no stale data: the list can no longer be read. A 404 of a list is a traced
 * service error (`classifyTransactionFailure`), never an empty list.
 */
export function readOf<T>(query: QueryLike<T>): BlockRead<T> {
  const failure = query.isError ? classifyTransactionFailure(query.error, 'list') : null
  if (query.data !== undefined && !(query.isRefetchError && (failure?.kind === 'forbidden' || failure?.kind === 'ended'))) {
    return { kind: 'ready', value: query.data, readAt: query.dataUpdatedAt, stale: query.isRefetchError }
  }
  if (failure !== null) return { kind: 'failed', failure }
  return { kind: 'pending' }
}

/** The page holds the whole population the server counted. */
export const isComplete = (page: Pick<TransactionPage<unknown>, 'items' | 'totalItems'>): boolean => page.items.length >= page.totalItems

const oldest = (times: readonly number[]): number => Math.min(...times)

/** Several reads, one verdict: pending while any is, failed only when all are, else what the successful ones say. */
function settle<T>(reads: readonly BlockRead<T>[]): { readonly state: 'pending' } | { readonly state: 'failed'; readonly failure: TransactionFailure } | { readonly state: 'ready'; readonly ready: readonly { value: T; readAt: number; stale: boolean; index: number }[]; readonly unread: readonly number[] } {
  if (reads.some((read) => read.kind === 'pending')) return { state: 'pending' }
  const ready = reads.flatMap((read, index) => (read.kind === 'ready' ? [{ value: read.value, readAt: read.readAt, stale: read.stale, index }] : []))
  const firstFailure = reads.find((read): read is Extract<BlockRead<T>, { kind: 'failed' }> => read.kind === 'failed')
  if (ready.length === 0 && firstFailure !== undefined) return { state: 'failed', failure: firstFailure.failure }
  return { state: 'ready', ready, unread: reads.flatMap((read, index) => (read.kind === 'failed' ? [index] : [])) }
}

/**
 * Distinct rows observed over several requests (§17 takes one `status` per request). The requests are not one snapshot:
 * a row that changes status between two of them is counted once, and it may be missed. So `n` is an observation, never
 * a total and never a minimum of the population. `complete` says every status was read in full; otherwise `n` covers
 * only the rows read.
 */
export interface ObservedCount {
  readonly n: number
  readonly complete: boolean
}

// ---------------------------------------------------------------- anomalies

export interface AnomalySummary {
  /** `totalItems` of the OPEN read: the whole population, whatever the page holds. */
  readonly total: number
  readonly rows: readonly AnomalyView[]
}

const SEVERITY_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const
const severityRank = (anomaly: AnomalyView): number => (anomaly.severity === UNRECOGNIZED ? 0 : SEVERITY_RANK[anomaly.severity])

/**
 * Most urgent first, then most recent: possible only when the page is the whole population. A longer list keeps the
 * server's order (most recent first), since sorting a part by severity would call its worst row « the most urgent ».
 * An unrecognized severity comes last; it is still shown and counted.
 */
export function summarizeAnomalies(read: BlockRead<TransactionPage<AnomalyView>>): BlockRead<AnomalySummary> {
  if (read.kind !== 'ready') return read
  const { items, totalItems } = read.value
  const ordered = isComplete(read.value)
    ? [...items].sort((a, b) => severityRank(b) - severityRank(a) || (a.detectedAt < b.detectedAt ? 1 : a.detectedAt > b.detectedAt ? -1 : 0))
    : items
  return { kind: 'ready', value: { total: totalItems, rows: ordered.slice(0, ROW_LIMIT) }, readAt: read.readAt, stale: read.stale }
}

// -------------------------------------------------------------------- loans

export type LoansGap =
  /** A status could not be read: the loans of that status are missing from the count. */
  | { readonly kind: 'unread'; readonly statuses: readonly LoanStatus[] }
  /** A status holds more loans than one page: only the most recent ones were read. */
  | { readonly kind: 'truncated'; readonly read: number; readonly total: number }

export interface LoanSummary {
  /** Overdue loans among the ones read, by the server's `overdue`, longest overdue first. */
  readonly overdue: readonly LoanView[]
  readonly count: ObservedCount
  readonly gaps: readonly LoansGap[]
}

export function summarizeLoans(reads: readonly BlockRead<TransactionPage<LoanView>>[]): BlockRead<LoanSummary> {
  const settled = settle(reads)
  if (settled.state !== 'ready') return settled.state === 'pending' ? { kind: 'pending' } : { kind: 'failed', failure: settled.failure }
  const seenIds = new Set<string>()
  const overdue: LoanView[] = []
  const gaps: LoansGap[] = []
  let read = 0
  let total = 0
  let truncated = false
  for (const { value } of settled.ready) {
    read += value.items.length
    total += value.totalItems
    if (!isComplete(value)) truncated = true
    for (const loan of value.items) {
      if (seenIds.has(loan.id)) continue
      seenIds.add(loan.id)
      if (isShownOverdue(loan)) overdue.push(loan)
    }
  }
  if (settled.unread.length > 0) gaps.push({ kind: 'unread', statuses: settled.unread.map((index) => OPEN_LOAN_STATUSES[index] as LoanStatus) })
  if (truncated) gaps.push({ kind: 'truncated', read, total })
  // `dueAt` only orders what the server already flagged; it never decides what is overdue.
  overdue.sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0))
  return {
    kind: 'ready',
    value: { overdue, count: { n: overdue.length, complete: gaps.length === 0 }, gaps },
    readAt: oldest(settled.ready.map((r) => r.readAt)),
    stale: settled.ready.some((r) => r.stale),
  }
}

// --------------------------------------------------------------- operations

export interface OperationSummary {
  /**
   * Distinct operations observed in a non-final status. Never the sum of the `totalItems`: an operation that moves from
   * one status to the next between two reads is in both totals.
   */
  readonly count: ObservedCount
  /** The most recent operations of the statuses read, as many as the preview holds. */
  readonly rows: readonly LockerOperationView[]
  /** Statuses that could not be read. */
  readonly unread: readonly LockerOperationStatus[]
  /** A status holds more operations than one page: only the most recent of it were read. */
  readonly truncated: boolean
}

export function summarizeOperations(reads: readonly BlockRead<TransactionPage<LockerOperationView>>[]): BlockRead<OperationSummary> {
  const settled = settle(reads)
  if (settled.state !== 'ready') return settled.state === 'pending' ? { kind: 'pending' } : { kind: 'failed', failure: settled.failure }
  const seen = new Set<string>()
  const merged: LockerOperationView[] = []
  let truncated = false
  for (const { value } of settled.ready) {
    if (!isComplete(value)) truncated = true
    for (const operation of value.items) {
      if (seen.has(operation.id)) continue
      seen.add(operation.id)
      merged.push(operation)
    }
  }
  // Each status list is newest first (09 §17), so the newest of the merge are among the first rows of each.
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))
  const unread = settled.unread.map((index) => IN_PROGRESS_OPERATION_STATUSES[index] as LockerOperationStatus)
  return {
    kind: 'ready',
    value: { count: { n: merged.length, complete: unread.length === 0 && !truncated }, rows: merged.slice(0, ROW_LIMIT), unread, truncated },
    readAt: oldest(settled.ready.map((r) => r.readAt)),
    stale: settled.ready.some((r) => r.stale),
  }
}

// ------------------------------------------------------------------- labels

/**
 * Codes the locker list gives for identifiers that anomalies and operations carry alone (G3). Only what the list states:
 * a compartment code by compartment id, and the code of the asset the list places in a compartment. An identifier the
 * list does not name has no label here, and the row then shows the identifier.
 */
export interface Labels {
  readonly compartmentCode: (compartmentId: string | null) => string | null
  readonly assetCode: (assetId: string | null) => string | null
}

export const NO_LABELS: Labels = { compartmentCode: () => null, assetCode: () => null }

export function labelsOf(page: AdminLockerPage | undefined): Labels {
  if (page === undefined) return NO_LABELS
  const compartments = new Map<string, string>()
  const assets = new Map<string, string>()
  for (const locker of page.items) {
    for (const compartment of locker.compartments) {
      compartments.set(compartment.id, compartment.code)
      if (compartment.currentAsset !== null) assets.set(compartment.currentAsset.id, compartment.currentAsset.assetCode)
    }
  }
  return { compartmentCode: (id) => (id === null ? null : (compartments.get(id) ?? null)), assetCode: (id) => (id === null ? null : (assets.get(id) ?? null)) }
}

/** The oldest read of the blocks that have data: everything the page shows is at least this recent. */
export function oldestRead(reads: readonly BlockRead<unknown>[]): number | null {
  const times = reads.flatMap((read) => (read.kind === 'ready' ? [read.readAt] : []))
  return times.length === 0 ? null : oldest(times)
}
