import { describe, expect, it, vi } from 'vitest'
import { problemBody } from '../auth/testFixtures'
import { createHttpCatalogGateway } from './httpCatalogGateway'
import { MM001, pageOf } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const SERVER_REQUEST_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type, 'X-Request-Id': SERVER_REQUEST_ID } })
}

function gatewayWith(answer: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer())
  return { gateway: createHttpCatalogGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID }), fetchMock }
}

describe('httpCatalogGateway', () => {
  it('lists with the bearer token, the page, the size and the sort, and no body', async () => {
    const page = pageOf([MM001])
    const { gateway, fetchMock } = gatewayWith(async () => json(200, page))
    const result = await gateway.listAssets(TOKEN, { page: 2, size: 20, sort: 'assetCode,asc' })

    expect(result).toEqual({ kind: 'ok', value: page, requestId: SERVER_REQUEST_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/admin/assets?page=2&size=20&sort=assetCode%2Casc')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.credentials).toBe('omit')
    expect(init?.headers).toEqual({ Accept: 'application/json, application/problem+json', 'X-Request-Id': REQUEST_ID, Authorization: `Bearer ${TOKEN}` })
  })

  it('reads one unit by its id', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, MM001))
    const result = await gateway.getAsset(TOKEN, MM001.id)
    expect(result.kind === 'ok' && result.value.assetCode).toBe('MM-001')
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/admin/assets/${MM001.id}`)
  })

  it('does not let an id break out of the path', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(404, problemBody(404, 'RESOURCE_NOT_FOUND'), 'application/problem+json'))
    await gateway.getAsset(TOKEN, '../auth/me')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/assets/..%2Fauth%2Fme')
  })

  it('reports a 2xx body that is not the contract as an invalid response', async () => {
    const { gateway } = gatewayWith(async () => json(200, { items: [{ id: 'x' }] }))
    expect(await gateway.listAssets(TOKEN, { page: 0, size: 20, sort: 'assetCode,asc' })).toEqual({ kind: 'invalidResponse', status: 200, requestId: SERVER_REQUEST_ID })
  })

  it('keeps the problem body of a 404 for the caller, without reading its detail', async () => {
    const body = problemBody(404, 'RESOURCE_NOT_FOUND')
    const { gateway } = gatewayWith(async () => json(404, body, 'application/problem+json'))
    const result = await gateway.getAsset(TOKEN, MM001.id)
    expect(result).toMatchObject({ kind: 'httpProblem', status: 404, problem: { code: 'RESOURCE_NOT_FOUND' } })
  })

  it('maps a network failure to unreachable', async () => {
    const { gateway } = gatewayWith(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await gateway.listAssets(TOKEN, { page: 0, size: 20, sort: 'assetCode,asc' })).toEqual({ kind: 'network', reason: 'offline' })
  })
})
