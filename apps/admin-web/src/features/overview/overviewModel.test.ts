import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../api/serverState'
import { parseAnomalyView } from '../anomalies/contractParsers'
import { anomalyView } from '../anomalies/testFixtures'
import { problemBody } from '../auth/testFixtures'
import { parseLoanView, parseLockerOperationView } from '../transactions/contractParsers'
import type { LoanView, LockerOperationView, TransactionPage } from '../transactions/contract'
import { loanView, lockerOperationView } from '../transactions/testFixtures'
import type { AnomalyView } from '../anomalies/contract'
import {
  IN_PROGRESS_OPERATION_STATUSES,
  isComplete,
  labelsOf,
  oldestRead,
  readOf,
  ROW_LIMIT,
  summarizeAnomalies,
  summarizeLoans,
  summarizeOperations,
  type BlockRead,
} from './overviewModel'

const must = <T,>(value: T | null): T => {
  if (value === null) throw new Error('fixture breaks the contract')
  return value
}
const loan = (overrides: Record<string, unknown> = {}): LoanView => must(parseLoanView(loanView(overrides)))
const operation = (overrides: Record<string, unknown> = {}): LockerOperationView => must(parseLockerOperationView(lockerOperationView(overrides)))
const anomaly = (overrides: Record<string, unknown> = {}): AnomalyView => must(parseAnomalyView(anomalyView(overrides)))
const page = <T,>(items: T[], totalItems = items.length): TransactionPage<T> => ({ items, page: 0, size: 100, totalItems, totalPages: totalItems > items.length ? 2 : 1 })
const ready = <T,>(value: T, readAt = 1_000, stale = false): BlockRead<T> => ({ kind: 'ready', value, readAt, stale })
const failed: BlockRead<never> = { kind: 'failed', failure: { kind: 'unreachable' } }
const pending: BlockRead<never> = { kind: 'pending' }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('readOf', () => {
  const base = { data: undefined, error: null, isError: false, isRefetchError: false, dataUpdatedAt: 0 }
  const httpError = (status: number, code: string) => new ApiRequestError({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId: 'trace-7' }), retryAfter: null, requestId: 'req' })

  it('is pending before any answer, ready with data, and failed with an error and no data', () => {
    expect(readOf(base)).toEqual({ kind: 'pending' })
    expect(readOf({ ...base, data: 1, dataUpdatedAt: 5 })).toEqual({ kind: 'ready', value: 1, readAt: 5, stale: false })
    expect(readOf({ ...base, error: httpError(500, 'INTERNAL_ERROR'), isError: true })).toEqual({ kind: 'failed', failure: { kind: 'serviceError', traceId: 'trace-7' } })
  })

  it('reads the 404 of a list as a traced service error, never as an empty list', () => {
    expect(readOf({ ...base, error: httpError(404, 'RESOURCE_NOT_FOUND'), isError: true })).toEqual({ kind: 'failed', failure: { kind: 'serviceError', traceId: 'trace-7' } })
  })

  it('keeps the data of a failed refresh and marks it stale, but drops it once the server refuses the read (403)', () => {
    const refreshFailed = { ...base, data: 1, isError: true, isRefetchError: true, dataUpdatedAt: 9 }
    expect(readOf({ ...refreshFailed, error: httpError(503, 'SERVICE_UNAVAILABLE') })).toEqual({ kind: 'ready', value: 1, readAt: 9, stale: true })
    expect(readOf({ ...refreshFailed, error: httpError(403, 'FORBIDDEN') })).toEqual({ kind: 'failed', failure: { kind: 'forbidden' } })
  })
})

describe('summarizeAnomalies', () => {
  it('counts with the server total, not with the page', () => {
    const summary = summarizeAnomalies(ready(page([anomaly({ id: id(1) })], 12)))
    expect(summary.kind === 'ready' && summary.value.total).toBe(12)
  })

  it('orders a complete page by severity, then by recency, and previews at most ROW_LIMIT rows', () => {
    const rows = [
      anomaly({ id: id(1), severity: 'LOW', detectedAt: '2026-11-10T10:00:00Z' }),
      anomaly({ id: id(2), severity: 'HIGH', detectedAt: '2026-11-10T08:00:00Z' }),
      anomaly({ id: id(3), severity: 'HIGH', detectedAt: '2026-11-10T09:00:00Z' }),
      anomaly({ id: id(4), severity: 'MEDIUM', detectedAt: '2026-11-10T11:00:00Z' }),
      anomaly({ id: id(5), severity: 'LOW', detectedAt: '2026-11-10T12:00:00Z' }),
      anomaly({ id: id(6), severity: 'LOW', detectedAt: '2026-11-10T07:00:00Z' }),
    ]
    const summary = summarizeAnomalies(ready(page(rows)))
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.rows.map((row) => row.id)).toEqual([id(3), id(2), id(4), id(5), id(1)])
    expect(summary.value.rows).toHaveLength(ROW_LIMIT)
  })

  it('keeps the server order when the page is only a part: a part sorted by severity would name a false « most urgent »', () => {
    const rows = [anomaly({ id: id(1), severity: 'LOW' }), anomaly({ id: id(2), severity: 'HIGH' })]
    const summary = summarizeAnomalies(ready(page(rows, 40)))
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.rows.map((row) => row.id)).toEqual([id(1), id(2)])
  })

  it('passes pending and failed reads through untouched', () => {
    expect(summarizeAnomalies(pending)).toEqual({ kind: 'pending' })
    expect(summarizeAnomalies(failed)).toEqual(failed)
  })
})

describe('summarizeLoans', () => {
  const late = (n: number, overrides: Record<string, unknown> = {}) => loan({ id: id(n), overdue: true, ...overrides })

  it('is complete when both statuses were read in full, and counts only the loans the server flags', () => {
    const summary = summarizeLoans([
      ready(page([late(1), loan({ id: id(2), overdue: false })])),
      ready(page([late(3, { status: 'RETURN_PENDING' })])),
    ])
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 2, complete: true })
    expect(summary.value.gaps).toEqual([])
    expect(summary.value.overdue.map((row) => row.id).sort()).toEqual([id(1), id(3)])
  })

  it('counts once a loan seen in both reads because its return was requested between them', () => {
    const summary = summarizeLoans([ready(page([late(4, { status: 'ACTIVE' })])), ready(page([late(4, { status: 'RETURN_PENDING' })]))])
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 1, complete: true })
    expect(summary.value.overdue.map((row) => row.id)).toEqual([id(4)])
  })

  it('never computes a delay from `dueAt`: a loan past its due date but not flagged is not overdue', () => {
    const pastDue = loan({ id: id(1), dueAt: '2020-01-01T00:00:00Z', overdue: false })
    const summary = summarizeLoans([ready(page([pastDue])), ready(page([]))])
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 0, complete: true })
  })

  it('covers only the loans read, with the missing status named, when one read failed', () => {
    const summary = summarizeLoans([ready(page([late(1)])), failed])
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 1, complete: false })
    expect(summary.value.gaps).toEqual([{ kind: 'unread', statuses: ['RETURN_PENDING'] }])
  })

  it('covers only the loans read when a status holds more loans than the page read', () => {
    const summary = summarizeLoans([ready(page([late(1)], 240)), ready(page([]))])
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count.complete).toBe(false)
    expect(summary.value.gaps).toEqual([{ kind: 'truncated', read: 1, total: 240 }])
    expect(isComplete(page([late(1)], 240))).toBe(false)
  })

  it('is failed, not zero, when every read failed, and pending while any read is', () => {
    expect(summarizeLoans([failed, failed])).toEqual({ kind: 'failed', failure: { kind: 'unreachable' } })
    expect(summarizeLoans([ready(page([])), pending])).toEqual({ kind: 'pending' })
  })

  it('shows the longest overdue first and takes the oldest read as the block\'s freshness', () => {
    const summary = summarizeLoans([ready(page([late(1, { dueAt: '2026-11-10T18:00:00Z' }), late(2, { dueAt: '2026-11-10T12:00:00Z' })], 2), 3_000), ready(page([]), 2_000, true)])
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.overdue.map((row) => row.id)).toEqual([id(2), id(1)])
    expect(summary.readAt).toBe(2_000)
    expect(summary.stale).toBe(true)
  })
})

describe('summarizeOperations', () => {
  const statusCount = IN_PROGRESS_OPERATION_STATUSES.length
  const reads = (answers: Record<number, BlockRead<TransactionPage<LockerOperationView>>>) => Array.from({ length: statusCount }, (_, index) => answers[index] ?? ready(page<LockerOperationView>([])))

  it('reads the seven non-final statuses and none of the final ones', () => {
    expect(IN_PROGRESS_OPERATION_STATUSES).toEqual(['REQUESTED', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED'])
  })

  it('counts the distinct operations observed and previews the newest of them', () => {
    const summary = summarizeOperations(
      reads({
        1: ready(page([operation({ id: id(1), status: 'AWAITING_LOCAL_PROOF', createdAt: '2026-11-10T10:00:00Z' })], 1)),
        4: ready(page([operation({ id: id(2), status: 'COMMAND_ACKNOWLEDGED', createdAt: '2026-11-10T12:00:00Z' })], 1)),
      }),
    )
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 2, complete: true })
    expect(summary.value.truncated).toBe(false)
    expect(summary.value.rows.map((row) => row.id)).toEqual([id(2), id(1)])
  })

  it('counts once an operation that changed status between two reads, where the sum of the totals would say 2', () => {
    // The AUTHORIZED read sees it before the command, the COMMAND_SENT read after: each status total is 1.
    const before = operation({ id: id(7), status: 'AUTHORIZED' })
    const after = operation({ id: id(7), status: 'COMMAND_SENT' })
    const summary = summarizeOperations(reads({ 2: ready(page([before], 1)), 3: ready(page([after], 1)) }))
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 1, complete: true })
    expect(summary.value.rows.map((row) => row.id)).toEqual([id(7)])
  })

  it('covers only the operations read, never a total, when a status holds more than one page', () => {
    const summary = summarizeOperations(reads({ 0: ready(page([operation({ id: id(1) })], 240)) }))
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 1, complete: false })
    expect(summary.value.truncated).toBe(true)
  })

  it('covers only the operations read, naming the statuses it could not read', () => {
    const summary = summarizeOperations(reads({ 2: failed, 3: failed, 0: ready(page([operation({ id: id(1) })], 1)) }))
    if (summary.kind !== 'ready') throw new Error('not ready')
    expect(summary.value.count).toEqual({ n: 1, complete: false })
    expect(summary.value.unread).toEqual(['AUTHORIZED', 'COMMAND_SENT'])
  })

  it('is failed when every status failed', () => {
    expect(summarizeOperations(reads(Object.fromEntries(IN_PROGRESS_OPERATION_STATUSES.map((_, index) => [index, failed]))))).toEqual({ kind: 'failed', failure: { kind: 'unreachable' } })
  })
})

describe('labelsOf and oldestRead', () => {
  it('names a compartment and the asset the list places there, and nothing else', () => {
    const labels = labelsOf({ items: [{ id: id(1), code: 'AEGIS-DEMO-01', name: 'x', topology: 'HUB_CELL', compartments: [{ id: id(2), code: 'A1', enabled: true, currentAsset: { id: id(3), assetCode: 'MM-001' } }] }], page: 0, size: 100, totalItems: 1, totalPages: 1 })
    expect(labels.compartmentCode(id(2))).toBe('A1')
    expect(labels.assetCode(id(3))).toBe('MM-001')
    expect(labels.assetCode(id(9))).toBeNull()
    expect(labels.compartmentCode(null)).toBeNull()
  })

  it('takes the oldest read of the blocks that have data, and none when none has', () => {
    expect(oldestRead([ready(1, 5_000), ready(2, 3_000), failed, pending])).toBe(3_000)
    expect(oldestRead([failed, pending])).toBeNull()
  })
})
