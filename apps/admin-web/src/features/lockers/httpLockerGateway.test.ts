import { describe, expect, it, vi } from 'vitest'
import { problemBody } from '../auth/testFixtures'
import { createHttpLockerGateway } from './httpLockerGateway'
import { DEMO_LOCKER_ID, lockerStatus } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const SERVER_REQUEST_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type, 'X-Request-Id': SERVER_REQUEST_ID } })
}

function gatewayWith(answer: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer())
  return { gateway: createHttpLockerGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID }), fetchMock }
}

describe('httpLockerGateway', () => {
  it('reads the status with a GET, the bearer token and no body, and nothing else', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, lockerStatus()))
    const result = await gateway.getStatus(TOKEN, DEMO_LOCKER_ID)

    expect(result).toEqual({ kind: 'ok', value: lockerStatus(), requestId: SERVER_REQUEST_ID })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/v1/lockers/${DEMO_LOCKER_ID}/status`)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.credentials).toBe('omit')
    expect(init?.headers).toEqual({ Accept: 'application/json, application/problem+json', 'X-Request-Id': REQUEST_ID, Authorization: `Bearer ${TOKEN}` })
  })

  it('exposes no method that writes: the gateway is a single read', () => {
    expect(Object.keys(createHttpLockerGateway())).toEqual(['getStatus'])
  })

  it('does not let an id break out of the path', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(404, problemBody(404, 'RESOURCE_NOT_FOUND'), 'application/problem+json'))
    await gateway.getStatus(TOKEN, '../auth/me')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/lockers/..%2Fauth%2Fme/status')
  })

  it('reports a 2xx body that is not the contract as an invalid response', async () => {
    const { gateway } = gatewayWith(async () => json(200, { lockerId: DEMO_LOCKER_ID }))
    expect(await gateway.getStatus(TOKEN, DEMO_LOCKER_ID)).toEqual({ kind: 'invalidResponse', status: 200, requestId: SERVER_REQUEST_ID })
  })

  it('keeps the problem body of a 404 for the caller', async () => {
    const { gateway } = gatewayWith(async () => json(404, problemBody(404, 'RESOURCE_NOT_FOUND'), 'application/problem+json'))
    expect(await gateway.getStatus(TOKEN, DEMO_LOCKER_ID)).toMatchObject({ kind: 'httpProblem', status: 404, problem: { code: 'RESOURCE_NOT_FOUND' } })
  })

  it('keeps a 401 as an http problem, for the session store to end the session', async () => {
    const { gateway } = gatewayWith(async () => json(401, problemBody(401, 'AUTH_TOKEN_EXPIRED'), 'application/problem+json'))
    expect(await gateway.getStatus(TOKEN, DEMO_LOCKER_ID)).toMatchObject({ kind: 'httpProblem', status: 401, problem: { code: 'AUTH_TOKEN_EXPIRED' } })
  })

  it('maps a network failure to unreachable', async () => {
    const { gateway } = gatewayWith(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await gateway.getStatus(TOKEN, DEMO_LOCKER_ID)).toEqual({ kind: 'network', reason: 'offline' })
  })
})
