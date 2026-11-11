import { beforeAll, describe, expect, it } from 'vitest'
import { createHttpAnomalyGateway } from '../features/anomalies/httpAnomalyGateway'
import { createHttpCustodyGateway } from '../features/custody/httpCustodyGateway'
import { createHttpLockerGateway } from '../features/lockers/httpLockerGateway'
import { IN_PROGRESS_OPERATION_STATUSES, OPEN_LOAN_STATUSES, ROW_LIMIT, WIDE_PAGE_SIZE, labelsOf, summarizeAnomalies, summarizeLoans, summarizeOperations, type BlockRead } from '../features/overview/overviewModel'
import { createHttpTransactionGateway } from '../features/transactions/httpTransactionGateway'
import type { GatewayResult } from '../features/auth/authGateway'

/**
 * Opt-in check of the Vue d'ensemble reads against a running, isolated Aegis API (never staging or the hub). Skipped
 * unless AEGIS_IT_API_ORIGIN, AEGIS_IT_ADMIN_EMAIL and AEGIS_IT_ADMIN_PASSWORD are set. It only reads: the same routes,
 * query strings and page sizes the overview sends, through the production gateways and parsers.
 */
const origin = process.env.AEGIS_IT_API_ORIGIN
const email = process.env.AEGIS_IT_ADMIN_EMAIL
const password = process.env.AEGIS_IT_ADMIN_PASSWORD

async function signIn(): Promise<string> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await response.json()) as { accessToken: string }
  return body.accessToken
}

/** A gateway answer as the page would hold it: ready with the value, or failed. A failure here fails the test. */
function ready<T>(result: GatewayResult<T>): BlockRead<T> {
  expect(result.kind).toBe('ok')
  if (result.kind !== 'ok') return { kind: 'failed', failure: { kind: 'serviceError', traceId: null } }
  return { kind: 'ready', value: result.value, readAt: Date.now(), stale: false }
}

describe.skipIf(!origin || !email || !password)("Vue d'ensemble reads against an isolated API", () => {
  const options = { baseUrl: origin }
  // One sign-in for the whole file: the login route is rate limited (09 §10.2).
  let token = ''
  beforeAll(async () => {
    token = await signIn()
  })

  it('reads the open anomalies at the widest page and counts with totalItems', async () => {
    const read = ready(await createHttpAnomalyGateway(options).listAnomalies(token, { status: 'OPEN', page: 0, size: WIDE_PAGE_SIZE }))
    if (read.kind !== 'ready') return
    expect(read.value.totalItems).toBeGreaterThanOrEqual(read.value.items.length)
    expect(read.value.items.every((anomaly) => anomaly.status === 'OPEN')).toBe(true)
    const summary = summarizeAnomalies(read)
    expect(summary.kind === 'ready' && summary.value.total).toBe(read.value.totalItems)
    expect(summary.kind === 'ready' && summary.value.rows.length).toBeLessThanOrEqual(ROW_LIMIT)
  })

  it('reads the loans of each open status and keeps the overdue ones by the server flag only', async () => {
    const gateway = createHttpTransactionGateway(options)
    const reads = []
    for (const status of OPEN_LOAN_STATUSES) reads.push(ready(await gateway.listLoans(token, { status, page: 0, size: WIDE_PAGE_SIZE })))
    const summary = summarizeLoans(reads)
    if (summary.kind !== 'ready') return
    const flagged = reads.flatMap((read) => (read.kind === 'ready' ? read.value.items.filter((loan) => loan.overdue) : []))
    expect(summary.value.overdue).toHaveLength(flagged.length)
    expect(summary.value.overdue.every((loan) => loan.overdue && loan.status !== 'COMPLETED')).toBe(true)
    // The counts are exact only when each status was read in full.
    const complete = reads.every((read) => read.kind === 'ready' && read.value.items.length >= read.value.totalItems)
    expect(summary.value.count.exact).toBe(complete)
  })

  it('accepts every non-final operation status, and the total is the sum of the totals the server counted', async () => {
    const gateway = createHttpTransactionGateway(options)
    const reads = []
    for (const status of IN_PROGRESS_OPERATION_STATUSES) reads.push(ready(await gateway.listLockerOperations(token, { status, page: 0, size: ROW_LIMIT })))
    const summary = summarizeOperations(reads)
    if (summary.kind !== 'ready') return
    expect(summary.value.count.exact).toBe(true)
    expect(summary.value.count.n).toBe(reads.reduce((sum, read) => sum + (read.kind === 'ready' ? read.value.totalItems : 0), 0))
    expect(summary.value.rows.every((operation) => operation.terminalAt === null)).toBe(true)
  })

  it('reads the active reservations by status with a preview page and the server total', async () => {
    const read = ready(await createHttpTransactionGateway(options).listReservations(token, { status: 'ACTIVE', page: 0, size: ROW_LIMIT }))
    if (read.kind !== 'ready') return
    expect(read.value.totalItems).toBeGreaterThanOrEqual(read.value.items.length)
    expect(read.value.items.every((reservation) => reservation.status === 'ACTIVE')).toBe(true)
  })

  it('reads the lockers and the status of each, and joins the cells by id', async () => {
    const lockers = ready(await createHttpCustodyGateway(options).listLockers(token, { page: 0, size: 100 }))
    if (lockers.kind !== 'ready') return
    const labels = labelsOf(lockers.value)
    for (const locker of lockers.value.items) {
      const status = ready(await createHttpLockerGateway(options).getStatus(token, locker.id))
      if (status.kind !== 'ready') continue
      expect(status.value.code).toBe(locker.code)
      for (const cell of status.value.compartments) expect(labels.compartmentCode(cell.id)).toBe(cell.code)
    }
  })
})
