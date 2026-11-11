import { beforeAll, describe, expect, it } from 'vitest'
import { createHttpAnomalyGateway } from '../features/anomalies/httpAnomalyGateway'

/**
 * Opt-in check of the Web parsers against a running, isolated Aegis API (never staging or the hub). Skipped unless
 * AEGIS_IT_API_ORIGIN, AEGIS_IT_ADMIN_EMAIL and AEGIS_IT_ADMIN_PASSWORD are set. It reads only, except the one
 * acknowledgement of AEGIS_IT_ACK_ANOMALY_ID when that synthetic anomaly is given.
 */
const origin = process.env.AEGIS_IT_API_ORIGIN
const email = process.env.AEGIS_IT_ADMIN_EMAIL
const password = process.env.AEGIS_IT_ADMIN_PASSWORD
const ackAnomalyId = process.env.AEGIS_IT_ACK_ANOMALY_ID

async function signIn(): Promise<string> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await response.json()) as { accessToken: string }
  return body.accessToken
}

describe.skipIf(!origin || !email || !password)('§18 anomalies against an isolated API', () => {
  const options = { baseUrl: origin }
  // One sign-in for the whole file: the login route is rate limited (09 §10.2).
  let token = ''
  beforeAll(async () => {
    token = await signIn()
  })

  it('parses the §18 anomaly list and every detail, with its provisional evidence section', async () => {
    const gateway = createHttpAnomalyGateway(options)
    const list = await gateway.listAnomalies(token, { page: 0, size: 100 })
    expect(list.kind).toBe('ok')
    if (list.kind !== 'ok') return
    for (const anomaly of list.value.items) {
      const detail = await gateway.getAnomaly(token, anomaly.id)
      expect(detail.kind === 'ok' && detail.value.id).toBe(anomaly.id)
      expect(detail.kind === 'ok' && detail.value.evidence !== null).toBe(true)
    }
  })
  it('reports an invalid filter as a 400 problem, not as data', async () => {
    const result = await createHttpAnomalyGateway(options).listAnomalies(token, { from: '2026-11-11T00:00:00Z', to: '2026-11-10T00:00:00Z', page: 0, size: 20 })
    expect(result.kind === 'httpProblem' && result.status).toBe(400)
  })
  it.skipIf(!ackAnomalyId)('acknowledges once, replays the same key, and never resolves', async () => {
    const gateway = createHttpAnomalyGateway(options)
    const key = crypto.randomUUID()
    const first = await gateway.acknowledge(token, ackAnomalyId!, { note: 'Synthetic integration note.' }, key)
    const replay = await gateway.acknowledge(token, ackAnomalyId!, { note: 'Synthetic integration note.' }, key)
    expect(first.kind === 'ok' && [first.value.status, first.value.resolvedAt]).toEqual(['ACKNOWLEDGED', null])
    expect(replay.kind === 'ok' && replay.value).toEqual(first.kind === 'ok' && first.value)
    const again = await gateway.acknowledge(token, ackAnomalyId!, { note: 'Another note.' }, crypto.randomUUID())
    expect(again.kind === 'httpProblem' && again.problem?.code).toBe('ANOMALY_NOT_ACKNOWLEDGEABLE')
  })
})
