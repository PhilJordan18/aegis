import { vi } from 'vitest'
import type { GatewayResult } from '../auth/authGateway'
import { problemBody } from '../auth/testFixtures'
import type { AuditGateway } from './auditGateway'
import type { AuditEventView, AuditPage } from './contract'
import { parseAuditEventView } from './contractParsers'

/** Fictional §19 records for tests only; never imported by production code. */
export const EVENT_ID = '5d6e7f80-91a2-4b3c-8d4e-5f60718293a4'
export const SUBJECT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
export const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'
export const ADMIN_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'

export const auditEvent = (overrides: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  eventType: 'ASSET_UPDATED',
  actor: { id: ADMIN_ID, displayName: 'Administrateur de démonstration' },
  subjectType: 'ASSET',
  subjectId: SUBJECT_ID,
  operationId: null,
  fromState: null,
  toState: null,
  result: 'ACCEPTED',
  reason: null,
  occurredAt: '2026-11-10T18:30:00Z',
  details: {},
  ...overrides,
})

// ---- Typed fixtures and a fake gateway for component tests ----
/** A well-formed UUID from a number, so each event of a test has its own. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A parsed event; `n` makes its id and its second unique (later events are later in the day). */
export function eventView(n: number, overrides: Record<string, unknown> = {}): AuditEventView {
  const event = parseAuditEventView(auditEvent({ id: uuid(n), occurredAt: `2026-11-11T19:${String(59 - (n % 50)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}Z`, ...overrides }))
  if (event === null) throw new Error('fixture is not a valid event')
  return event
}

export const auditPage = (items: readonly AuditEventView[], { nextCursor = null, hasMore = false }: { nextCursor?: string | null; hasMore?: boolean } = {}): AuditPage => ({
  items,
  nextCursor,
  hasMore,
})

export const pageOk = (page: AuditPage): GatewayResult<AuditPage> => ({ kind: 'ok', value: page, requestId: 'req-1' })

export const pageProblem = (status: number, code: string, extra: Parameters<typeof problemBody>[2] = {}): GatewayResult<AuditPage> => ({
  kind: 'httpProblem',
  status,
  problem: problemBody(status, code, extra),
  retryAfter: null,
  requestId: 'req-1',
})

export const pageUnreachable: GatewayResult<AuditPage> = { kind: 'network', reason: 'offline' }

type Answer = GatewayResult<AuditPage> | (() => Promise<GatewayResult<AuditPage>>)

/** Answers in order; the last one repeats. Each call is recorded with its query. */
export function fakeAuditGateway(answers: readonly Answer[]): AuditGateway & { listAuditEvents: ReturnType<typeof vi.fn> } {
  let calls = 0
  return {
    listAuditEvents: vi.fn(async () => {
      const answer = answers[Math.min(calls, answers.length - 1)]
      calls += 1
      if (answer === undefined) return pageUnreachable
      return typeof answer === 'function' ? answer() : answer
    }),
  }
}
