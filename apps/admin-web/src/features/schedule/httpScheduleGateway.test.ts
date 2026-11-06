import { describe, expect, it, vi } from 'vitest'
import { problemBody } from '../auth/testFixtures'
import { createHttpScheduleGateway } from './httpScheduleGateway'
import { scheduleView } from './testFixtures'

const TOKEN = 'opaque.jwt.value'
const REQUEST_ID = '11111111-2222-4333-8444-555555555555'
const LOCKER = 'd46a74ae-39dc-460b-8af0-38fc791b376a'

function json(status: number, body: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

function gatewayWith(answer: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer())
  return { gateway: createHttpScheduleGateway({ fetch: fetchMock, createRequestId: () => REQUEST_ID }), fetchMock }
}

describe('httpScheduleGateway', () => {
  it('reads the active schedule with a GET on the locker path', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(200, scheduleView()))
    const result = await gateway.getSchedule(TOKEN, LOCKER)
    expect(result).toMatchObject({ kind: 'ok', value: scheduleView() })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/v1/admin/lockers/${LOCKER}/operating-schedule`)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  it('saves with a PUT of the JSON body and no Idempotency-Key', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(200, scheduleView()))
    const request = { timeZone: 'America/Toronto', windows: scheduleView().windows }
    await gateway.putSchedule(TOKEN, LOCKER, request)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual(request)
    expect(Object.keys(init?.headers ?? {}).map((name) => name.toLowerCase())).not.toContain('idempotency-key')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' })
  })

  it('passes the not-configured problem through, and refuses a body that is not the contract', async () => {
    const missing = await gatewayWith(() => json(404, problemBody(404, 'OPERATING_SCHEDULE_NOT_CONFIGURED'), 'application/problem+json')).gateway.getSchedule(TOKEN, LOCKER)
    expect(missing).toMatchObject({ kind: 'httpProblem', status: 404, problem: { code: 'OPERATING_SCHEDULE_NOT_CONFIGURED' } })
    const broken = await gatewayWith(() => json(200, { ...scheduleView(), windows: [] })).gateway.getSchedule(TOKEN, LOCKER)
    expect(broken.kind).not.toBe('ok')
  })

  it('does not let an id break out of the path', async () => {
    const { gateway, fetchMock } = gatewayWith(() => json(404, problemBody(404, 'RESOURCE_NOT_FOUND'), 'application/problem+json'))
    await gateway.getSchedule(TOKEN, '../../auth/me')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/lockers/..%2F..%2Fauth%2Fme/operating-schedule')
  })
})
