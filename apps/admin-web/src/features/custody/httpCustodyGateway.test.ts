import { describe, expect, it, vi } from 'vitest'
import { problemBody } from '../auth/testFixtures'
import { createHttpCustodyGateway } from './httpCustodyGateway'
import { A1_ID, LOCKER_ID } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const KEY = '99999999-8888-4777-8666-555555555555'
const ASSET = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const IDENTIFIER = '2b3c4d5e-6f70-4a81-9b92-a3b4c5d6e7f8'

const identifierView = (overrides: Record<string, unknown> = {}) => ({
  id: IDENTIFIER,
  assetId: ASSET,
  type: 'RFID_UHF',
  value: 'E20034120123456789000001',
  active: true,
  assignedAt: '2026-11-01T14:00:00Z',
  revokedAt: null,
  ...overrides,
})
const placementView = {
  id: '3c4d5e6f-7081-4a92-8ba3-b4c5d6e7f809',
  assetId: ASSET,
  lockerId: LOCKER_ID,
  lockerCode: 'AEGIS-DEMO-01',
  compartmentId: A1_ID,
  compartmentCode: 'A1',
  assignedAt: '2026-11-06T15:00:00Z',
  reason: 'Rangement initial',
}
const lockerPage = {
  items: [
    {
      id: LOCKER_ID,
      code: 'AEGIS-DEMO-01',
      name: 'Casier de démonstration',
      topology: 'HUB_CELL',
      compartments: [{ id: A1_ID, code: 'A1', enabled: true, currentAsset: { id: ASSET, assetCode: 'MULTI-001' } }],
    },
  ],
  page: 0,
  size: 100,
  totalItems: 1,
  totalPages: 1,
}

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

function gatewayWith(answer: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer())
  return { gateway: createHttpCustodyGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID }), fetchMock }
}

const headerNames = (init: RequestInit | undefined) => Object.keys(init?.headers ?? {}).map((name) => name.toLowerCase())

describe('httpCustodyGateway', () => {
  it('reads the identifier history with a GET, revoked ones included', async () => {
    const history = [identifierView(), identifierView({ id: '4d5e6f70-8192-4aa3-9bb4-c5d6e7f8091a', active: false, revokedAt: '2026-11-02T10:00:00Z' })]
    const { gateway, fetchMock } = gatewayWith(() => json(200, history))
    const result = await gateway.listIdentifiers(TOKEN, ASSET)
    expect(result).toMatchObject({ kind: 'ok', value: history })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/v1/admin/assets/${ASSET}/identifiers`)
    expect(init?.method).toBe('GET')
  })

  it('assigns and revokes with a POST carrying the Idempotency-Key', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(201, identifierView()))
    await gateway.assignIdentifier(TOKEN, ASSET, { type: 'NFC', value: '04A224B2C35E80' }, KEY)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/v1/admin/assets/${ASSET}/identifiers`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ type: 'NFC', value: '04A224B2C35E80' })
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'Idempotency-Key': KEY })

    fetchMock.mockImplementationOnce(async () => json(200, identifierView({ active: false, revokedAt: '2026-11-06T15:00:00Z' })))
    const revoked = await gateway.revokeIdentifier(TOKEN, ASSET, IDENTIFIER, KEY)
    expect(revoked.kind).toBe('ok')
    const [revokeUrl, revokeInit] = fetchMock.mock.calls[1] ?? []
    expect(revokeUrl).toBe(`/api/v1/admin/assets/${ASSET}/identifiers/${IDENTIFIER}/revoke`)
    expect(revokeInit?.method).toBe('POST')
    expect(revokeInit?.headers).toMatchObject({ 'Idempotency-Key': KEY })
  })

  it('sets the placement with a PUT of the compartment and reason, and no Idempotency-Key', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(200, placementView))
    const result = await gateway.setPlacement(TOKEN, ASSET, { compartmentId: A1_ID, reason: 'Rangement initial' })
    expect(result).toMatchObject({ kind: 'ok', value: placementView })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/v1/admin/assets/${ASSET}/placement`)
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ compartmentId: A1_ID, reason: 'Rangement initial' })
    expect(headerNames(init)).not.toContain('idempotency-key')
  })

  it('lists the lockers with their compartments and occupancy, page and size in the query', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(200, lockerPage))
    const result = await gateway.listLockers(TOKEN, { page: 0, size: 100 })
    expect(result).toMatchObject({ kind: 'ok', value: lockerPage })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/lockers?page=0&size=100')
  })

  it('passes a custody refusal through, and refuses a body that is not the contract', async () => {
    const refused = await gatewayWith(() => json(409, problemBody(409, 'ASSET_HAS_OPEN_LOAN'), 'application/problem+json')).gateway.setPlacement(TOKEN, ASSET, {
      compartmentId: A1_ID,
      reason: 'x',
    })
    expect(refused).toMatchObject({ kind: 'httpProblem', status: 409, problem: { code: 'ASSET_HAS_OPEN_LOAN' } })
    const broken = await gatewayWith(() => json(200, [{ ...identifierView(), active: 'yes' }])).gateway.listIdentifiers(TOKEN, ASSET)
    expect(broken.kind).not.toBe('ok')
  })

  it('does not let an id break out of the path', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(404, problemBody(404, 'RESOURCE_NOT_FOUND'), 'application/problem+json'))
    await gateway.revokeIdentifier(TOKEN, '../../auth', '../me', KEY)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/assets/..%2F..%2Fauth/identifiers/..%2Fme/revoke')
  })
})
