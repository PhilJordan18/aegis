import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../../api/serverState'
import { problemBody } from '../auth/testFixtures'
import { UNRECOGNIZED } from '../catalog/contract'
import { classifyAcknowledgeFailure, classifyAnomalyReadFailure } from './anomalyFailure'
import { parseAnomalyPage, parseAnomalyView } from './contractParsers'
import { anomalySearch, createHttpAnomalyGateway } from './httpAnomalyGateway'
import { ANOMALY_ID, ASSET_ID, acknowledgedView, anomalyView } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const KEY = '99999999-8888-4777-8666-555555555555'

afterEach(() => vi.restoreAllMocks())

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

function gatewayWith(answer: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer())
  return { gateway: createHttpAnomalyGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID }), fetchMock }
}

const page = (items: unknown[]) => ({ items, page: 0, size: 20, totalItems: items.length, totalPages: 1 })

describe('parseAnomalyView (09 §8.7)', () => {
  it('reads an open and an acknowledged anomaly with the acknowledging administrator', () => {
    expect(parseAnomalyView(anomalyView())?.status).toBe('OPEN')
    const acknowledged = parseAnomalyView(acknowledgedView())
    expect(acknowledged?.acknowledgedBy?.displayName).toBe('Administrateur de démonstration')
    expect(acknowledged?.resolvedAt).toBeNull()
  })

  it('ignores the undefined evidence section of the detail instead of guessing its shape', () => {
    const parsed = parseAnomalyView(anomalyView({ evidence: [{ raw: 'payload' }] }))
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('evidence')
  })

  it('tolerates unknown type, severity and status values as UNRECOGNIZED', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parsed = parseAnomalyView(anomalyView({ type: 'NEW_TYPE', severity: 'CRITICAL', status: 'ARCHIVED' }))
    expect([parsed?.type, parsed?.severity, parsed?.status]).toEqual([UNRECOGNIZED, UNRECOGNIZED, UNRECOGNIZED])
  })

  it.each([
    ['an empty summary', { summary: '' }],
    ['an acknowledger without a name', { acknowledgedBy: { id: ASSET_ID } }],
    ['a non-UUID operation', { lockerOperationId: 'op-7' }],
    ['a detection instant without zone', { detectedAt: '2026-11-10T19:02:00' }],
    ['an empty acknowledgement note', { acknowledgementNote: '' }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseAnomalyView(anomalyView(overrides))).toBeNull()
  })

  it('rejects the whole page when one anomaly breaks the contract', () => {
    expect(parseAnomalyPage(page([anomalyView(), anomalyView({ id: null })]))).toBeNull()
  })
})

describe('httpAnomalyGateway', () => {
  it('lists with only the filters that are set', async () => {
    expect(anomalySearch({ page: 0, size: 20 })).toBe('page=0&size=20')
    const { gateway, fetchMock } = gatewayWith(() => json(200, page([anomalyView()])))
    const result = await gateway.listAnomalies(TOKEN, { status: 'OPEN', severity: 'HIGH', assetId: ASSET_ID, page: 1, size: 20 })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/v1/admin/anomalies?status=OPEN&severity=HIGH&assetId=${ASSET_ID}&page=1&size=20`)
    expect(result.kind).toBe('ok')
  })

  it('acknowledges with a POST, the note as body and the caller’s idempotency key', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(200, acknowledgedView()))
    const result = await gateway.acknowledge(TOKEN, ANOMALY_ID, { note: 'Inspection planifiée.' }, KEY)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/v1/admin/anomalies/${ANOMALY_ID}/acknowledge`)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ note: 'Inspection planifiée.' }))
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe(KEY)
    expect(result.kind === 'ok' && result.value.status).toBe('ACKNOWLEDGED')
  })

  it('offers no resolve call', () => {
    const { gateway } = gatewayWith(() => json(200, {}))
    expect(Object.keys(gateway).sort()).toEqual(['acknowledge', 'getAnomaly', 'listAnomalies'])
  })
})

describe('anomaly failures', () => {
  const problem = (status: number, code: string) =>
    new ApiRequestError({ kind: 'httpProblem', status, problem: problemBody(status, code), retryAfter: null, requestId: REQUEST_ID })

  it('reads a 404 on the detail as a missing record, and on the list as a traced service error, never as empty', () => {
    const listFailure = classifyAnomalyReadFailure(problem(404, 'RESOURCE_NOT_FOUND'), 'list')
    expect(listFailure.kind === 'serviceError' && listFailure.traceId).toBeTruthy()
    expect(classifyAnomalyReadFailure(problem(404, 'RESOURCE_NOT_FOUND'), 'detail')).toEqual({ kind: 'notFound' })
  })

  it('maps the §18.2 refusals by code, and keeps the session and service kinds', () => {
    expect(classifyAcknowledgeFailure(problem(409, 'ANOMALY_ALREADY_RESOLVED'))).toEqual({ kind: 'alreadyResolved' })
    expect(classifyAcknowledgeFailure(problem(409, 'ANOMALY_NOT_ACKNOWLEDGEABLE'))).toEqual({ kind: 'notAcknowledgeable' })
    expect(classifyAcknowledgeFailure(problem(400, 'VALIDATION_ERROR'))).toEqual({ kind: 'invalidNote' })
    expect(classifyAcknowledgeFailure(problem(401, 'AUTH_TOKEN_EXPIRED'))).toEqual({ kind: 'ended' })
    expect(classifyAcknowledgeFailure(problem(409, 'IDEMPOTENCY_KEY_REUSED')).kind).toBe('serviceError')
  })
})
