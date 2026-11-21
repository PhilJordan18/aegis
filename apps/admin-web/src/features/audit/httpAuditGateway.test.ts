import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../../api/serverState'
import { problemBody } from '../auth/testFixtures'
import { classifyAuditFailure } from './auditFailure'
import { parseAuditEventView, parseAuditPage } from './contractParsers'
import { auditSearch, createHttpAuditGateway } from './httpAuditGateway'
import { OPERATION_ID, SUBJECT_ID, auditEvent } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'

afterEach(() => vi.restoreAllMocks())

describe('parseAuditEventView (09 §19.1)', () => {
  it('reads an event with its actor, correlation and transition', () => {
    const parsed = parseAuditEventView(auditEvent({ operationId: OPERATION_ID, fromState: 'OPEN', toState: 'ACKNOWLEDGED' }))
    expect(parsed?.actor).toEqual({ id: expect.any(String), displayName: 'Administrateur de démonstration' })
    expect([parsed?.operationId, parsed?.fromState, parsed?.toState]).toEqual([OPERATION_ID, 'OPEN', 'ACKNOWLEDGED'])
  })

  it('keeps a system event without actor, and an untyped actor shape visible as unreadable', () => {
    expect(parseAuditEventView(auditEvent({ actor: null }))?.actor).toBeNull()
    expect(parseAuditEventView(auditEvent({ actor: 'SYSTEM' }))?.actor).toEqual({ kind: 'unreadable' })
  })

  it('keeps unknown event codes as sent instead of mapping them to a known fact', () => {
    expect(parseAuditEventView(auditEvent({ eventType: 'FUTURE_EVENT' }))?.eventType).toBe('FUTURE_EVENT')
  })

  it('keeps the scalar details in the order sent and drops, then counts, every object and list', () => {
    const parsed = parseAuditEventView(
      auditEvent({ details: { lockerId: 'L1', attempt: 2, displayInstructionsStopped: true, revoked: null, changes: { name: 'x' }, endedOperationIds: ['a'], nested: [] } }),
    )
    expect(parsed?.details).toEqual({
      entries: [
        ['lockerId', 'L1'],
        ['attempt', 2],
        ['displayInstructionsStopped', true],
        ['revoked', null],
      ],
      omitted: 3,
    })
  })

  it('reads empty, missing and null details as none, and refuses details that are not an object', () => {
    expect(parseAuditEventView(auditEvent())?.details).toEqual({ entries: [], omitted: 0 })
    expect(parseAuditEventView(auditEvent({ details: undefined }))?.details).toEqual({ entries: [], omitted: 0 })
    expect(parseAuditEventView(auditEvent({ details: null }))?.details).toEqual({ entries: [], omitted: 0 })
    expect(parseAuditEventView(auditEvent({ details: ['a'] }))).toBeNull()
    expect(parseAuditEventView(auditEvent({ details: 'text' }))).toBeNull()
  })

  it('treats a key named like an object property as an ordinary entry', () => {
    const parsed = parseAuditEventView(auditEvent({ details: JSON.parse('{"__proto__":"x","constructor":"y"}') }))
    expect(parsed?.details.entries).toEqual([
      ['__proto__', 'x'],
      ['constructor', 'y'],
    ])
  })

  it.each([
    ['a lone fromState', { fromState: 'OPEN' }],
    ['a non-UUID subject', { subjectId: 'asset-7' }],
    ['an instant without zone', { occurredAt: '2026-11-10T18:30:00' }],
    ['an empty event type', { eventType: '' }],
    ['array details', { details: [] }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseAuditEventView(auditEvent(overrides))).toBeNull()
  })
})

describe('parseAuditPage (09 §22.2)', () => {
  it('reads a last page and a page with an opaque cursor', () => {
    expect(parseAuditPage({ items: [], nextCursor: null, hasMore: false })).toEqual({ items: [], nextCursor: null, hasMore: false })
    expect(parseAuditPage({ items: [auditEvent()], nextCursor: 'b3BhcXVl', hasMore: true })?.nextCursor).toBe('b3BhcXVl')
  })

  it('rejects a further page announced without a cursor, and a page with one broken event', () => {
    expect(parseAuditPage({ items: [], nextCursor: null, hasMore: true })).toBeNull()
    expect(parseAuditPage({ items: [auditEvent(), auditEvent({ id: 7 })], nextCursor: null, hasMore: false })).toBeNull()
  })
})

describe('httpAuditGateway', () => {
  it('sends the set filters, a clamped limit and the cursor unchanged', async () => {
    expect(auditSearch({ limit: 0 })).toBe('limit=1')
    expect(auditSearch({ limit: 500 })).toBe('limit=100')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [], nextCursor: null, hasMore: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const gateway = createHttpAuditGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID })
    const result = await gateway.listAuditEvents(TOKEN, { subjectType: 'ASSET', subjectId: SUBJECT_ID, limit: 50, cursor: 'a+b/c=' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/v1/admin/audit-events?subjectType=ASSET&subjectId=${SUBJECT_ID}&limit=50&cursor=a%2Bb%2Fc%3D`)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(result.kind).toBe('ok')
  })
})

describe('classifyAuditFailure', () => {
  const problem = (status: number, code: string) =>
    new ApiRequestError({ kind: 'httpProblem', status, problem: problemBody(status, code), retryAfter: null, requestId: REQUEST_ID })

  it('distinguishes a stale cursor, a traced 404 and the session kinds', () => {
    expect(classifyAuditFailure(problem(400, 'INVALID_CURSOR'))).toEqual({ kind: 'invalidCursor' })
    const notFound = classifyAuditFailure(problem(404, 'RESOURCE_NOT_FOUND'))
    expect(notFound.kind === 'serviceError' && notFound.traceId).toBeTruthy()
    expect(classifyAuditFailure(problem(403, 'FORBIDDEN')).kind).toBe('forbidden')
    expect(classifyAuditFailure(problem(401, 'AUTH_TOKEN_EXPIRED'))).toEqual({ kind: 'ended' })
  })

  it('reads a refused filter as a validation failure naming its fields, not as a service error', () => {
    const refused = new ApiRequestError({
      kind: 'httpProblem',
      status: 400,
      problem: problemBody(400, 'VALIDATION_ERROR', { violations: [{ field: 'to', code: 'INVALID_VALUE', message: 'x' }] }),
      retryAfter: null,
      requestId: REQUEST_ID,
    })
    expect(classifyAuditFailure(refused)).toEqual({ kind: 'invalidFilter', fields: ['to'] })
    expect(classifyAuditFailure(problem(400, 'VALIDATION_ERROR'))).toEqual({ kind: 'invalidFilter', fields: [] })
  })
})
