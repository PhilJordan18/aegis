import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../../api/serverState'
import { problemBody } from '../auth/testFixtures'
import { createHttpTransactionGateway, transactionSearch } from './httpTransactionGateway'
import { classifyTransactionFailure } from './transactionFailure'
import { ASSET_ID, LOAN_ID, RESERVATION_ID, USER_ID, loanView, pageOf, reservationView } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

function gatewayWith(answer: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer())
  return { gateway: createHttpTransactionGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID }), fetchMock }
}

const urlOf = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) => String(fetchMock.mock.calls[0]?.[0])
const initOf = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) => fetchMock.mock.calls[0]?.[1]

describe('transactionSearch (09 §17)', () => {
  it('sends only the filters that are set, then the page, and no sort', () => {
    expect(transactionSearch({ page: 0, size: 20 })).toBe('page=0&size=20')
    expect(transactionSearch({ status: 'ACTIVE', assetId: ASSET_ID, userId: USER_ID, from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z', page: 2, size: 50 })).toBe(
      `status=ACTIVE&assetId=${ASSET_ID}&userId=${USER_ID}&from=2026-11-10T00%3A00%3A00Z&to=2026-11-11T00%3A00%3A00Z&page=2&size=50`,
    )
  })
})

describe('httpTransactionGateway', () => {
  it('lists loans with a bearer GET and no idempotency key', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(200, pageOf([loanView({ overdue: true })])))
    const result = await gateway.listLoans(TOKEN, { status: 'ACTIVE', page: 0, size: 20 })
    expect(urlOf(fetchMock)).toBe('/api/v1/admin/loans?status=ACTIVE&page=0&size=20')
    const init = initOf(fetchMock)
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect(Object.keys(init?.headers ?? {})).not.toContain('Idempotency-Key')
    expect(result.kind === 'ok' && result.value.items[0]?.overdue).toBe(true)
  })

  it('lists reservations and reads one reservation and one loan by encoded id', async () => {
    const lists = gatewayWith(() => json(200, pageOf([reservationView()])))
    expect((await lists.gateway.listReservations(TOKEN, { page: 1, size: 20 })).kind).toBe('ok')
    expect(urlOf(lists.fetchMock)).toBe('/api/v1/admin/reservations?page=1&size=20')

    const reservation = gatewayWith(() => json(200, reservationView()))
    expect((await reservation.gateway.getReservation(TOKEN, RESERVATION_ID)).kind).toBe('ok')
    expect(urlOf(reservation.fetchMock)).toBe(`/api/v1/admin/reservations/${RESERVATION_ID}`)

    const loan = gatewayWith(() => json(200, loanView()))
    expect((await loan.gateway.getLoan(TOKEN, `${LOAN_ID}/../x`)).kind).toBe('ok')
    expect(urlOf(loan.fetchMock)).toBe(`/api/v1/admin/loans/${encodeURIComponent(`${LOAN_ID}/../x`)}`)
  })

  it('reports a 2xx body outside the contract as invalid instead of guessing', async () => {
    const { gateway } = gatewayWith(() => json(200, pageOf([loanView({ overdue: null })])))
    expect((await gateway.listLoans(TOKEN, { page: 0, size: 20 })).kind).toBe('invalidResponse')
  })
})

describe('classifyTransactionFailure', () => {
  const problem = (status: number, code: string) =>
    new ApiRequestError({ kind: 'httpProblem', status, problem: problemBody(status, code), retryAfter: null, requestId: REQUEST_ID })

  it('reads a 404 on a list route as « not served yet », and on a detail route as a missing record', () => {
    expect(classifyTransactionFailure(problem(404, 'RESOURCE_NOT_FOUND'), 'list')).toEqual({ kind: 'notServed' })
    expect(classifyTransactionFailure(problem(404, 'RESOURCE_NOT_FOUND'), 'detail')).toEqual({ kind: 'notFound' })
  })

  it('keeps the session, permission and service kinds of the catalogue', () => {
    expect(classifyTransactionFailure(problem(401, 'AUTH_TOKEN_EXPIRED'), 'list')).toEqual({ kind: 'ended' })
    expect(classifyTransactionFailure(problem(403, 'FORBIDDEN'), 'list')).toEqual({ kind: 'forbidden' })
    expect(classifyTransactionFailure(problem(500, 'INTERNAL_ERROR'), 'list').kind).toBe('serviceError')
    expect(classifyTransactionFailure(new ApiRequestError({ kind: 'network', reason: 'offline' }), 'list')).toEqual({ kind: 'unreachable' })
  })
})
