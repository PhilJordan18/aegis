import { describe, expect, it, vi } from 'vitest'
import { problemBody } from '../auth/testFixtures'
import { createHttpCatalogGateway } from './httpCatalogGateway'
import { FLUKE_117, MM001, modelPageOf, pageOf } from './testFixtures'

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

const ASSET_REQUEST = {
  assetModelId: FLUKE_117.id,
  assetCode: 'MM-001',
  serialNumber: null,
  requiredAccessLevel: 'STANDARD',
  operationalStatus: 'SERVICEABLE',
  calibrationRequired: false,
  calibrationDueAt: null,
} as const
const KEY = '99999999-8888-4777-8666-555555555555'

describe('httpCatalogGateway — mutations (09 §12.1–12.2, §20)', () => {
  it('creates a unit with POST, a JSON body and the Idempotency-Key', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(201, MM001))
    const result = await gateway.createAsset(TOKEN, ASSET_REQUEST, KEY)
    expect(result.kind).toBe('ok')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/admin/assets')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(ASSET_REQUEST)
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'Idempotency-Key': KEY, Authorization: `Bearer ${TOKEN}` })
  })

  it('replaces a unit with PUT and never sends an Idempotency-Key', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, MM001))
    await gateway.updateAsset(TOKEN, MM001.id, ASSET_REQUEST)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/v1/admin/assets/${MM001.id}`)
    expect(init?.method).toBe('PUT')
    expect(Object.keys(init?.headers ?? {})).not.toContain('Idempotency-Key')
  })

  it('archives a unit and a model with a bodiless POST and the key', async () => {
    const { gateway, fetchMock } = gatewayWith(async () => json(200, MM001))
    await gateway.archiveAsset(TOKEN, MM001.id, KEY)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/admin/assets/${MM001.id}/archive`)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': KEY })

    const models = gatewayWith(async () => json(200, FLUKE_117))
    await models.gateway.archiveModel(TOKEN, FLUKE_117.id, KEY)
    expect(models.fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/admin/asset-models/${FLUKE_117.id}/archive`)
    expect(models.fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
  })

  it('lists, creates and replaces models on their routes', async () => {
    const list = gatewayWith(async () => json(200, modelPageOf([FLUKE_117])))
    expect((await list.gateway.listModels(TOKEN, { page: 1, size: 100 })).kind).toBe('ok')
    expect(list.fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/asset-models?page=1&size=100')

    const request = { name: 'Multimètre 1', manufacturer: null, modelNumber: null, description: null, defaultCalibrationRequired: true }
    const create = gatewayWith(async () => json(201, FLUKE_117))
    await create.gateway.createModel(TOKEN, request, KEY)
    expect(create.fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': KEY })
    expect(JSON.parse(String(create.fetchMock.mock.calls[0]?.[1]?.body))).toEqual(request)

    const update = gatewayWith(async () => json(200, FLUKE_117))
    await update.gateway.updateModel(TOKEN, FLUKE_117.id, request)
    expect(update.fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/admin/asset-models/${FLUKE_117.id}`)
    expect(update.fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT')
  })

  it('rejects a model body that is not the contract', async () => {
    const { gateway } = gatewayWith(async () => json(201, { id: FLUKE_117.id, name: 'x' }))
    expect((await gateway.createModel(TOKEN, { name: 'x', manufacturer: null, modelNumber: null, description: null, defaultCalibrationRequired: false }, KEY)).kind).toBe(
      'invalidResponse',
    )
  })
})

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
