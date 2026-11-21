import { beforeAll, describe, expect, it } from 'vitest'
import { createHttpAuditGateway } from '../features/audit/httpAuditGateway'

/**
 * Opt-in, read-only check of the Web audit parsers against a running, isolated Aegis API (never staging or the hub).
 * Skipped unless AEGIS_IT_API_ORIGIN, AEGIS_IT_ADMIN_EMAIL and AEGIS_IT_ADMIN_PASSWORD are set.
 */
const origin = process.env.AEGIS_IT_API_ORIGIN
const email = process.env.AEGIS_IT_ADMIN_EMAIL
const password = process.env.AEGIS_IT_ADMIN_PASSWORD

async function signIn(): Promise<string> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await response.json()) as { accessToken: string }
  return body.accessToken
}

/** The scalar leaves of a JSON value as dotted paths with list positions (`windows[0].opensAt`); an empty container has none. */
function leavesOf(value: unknown, path = ''): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leavesOf(item, `${path}[${index}]`))
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, nested]) => leavesOf(nested, path === '' ? key : `${path}.${key}`))
  return path === '' ? [] : [[path, value]]
}

describe.skipIf(!origin || !email || !password)('§19 audit timeline against an isolated API', () => {
  const options = { baseUrl: origin }
  // One sign-in for the whole file: the login route is rate limited (09 §10.2).
  let token = ''
  beforeAll(async () => {
    token = await signIn()
  })

  it('walks every page with the opaque cursor without repeating an event or losing an actor', async () => {
    const gateway = createHttpAuditGateway(options)
    const seen = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 200; page += 1) {
      const result = await gateway.listAuditEvents(token, { limit: 1, cursor })
      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') return
      for (const event of result.value.items) {
        expect(seen.has(event.id)).toBe(false)
        seen.add(event.id)
        expect(event.actor === null || !('kind' in event.actor)).toBe(true)
      }
      if (!result.value.hasMore) break
      cursor = result.value.nextCursor ?? undefined
    }
    expect(seen.size).toBeGreaterThan(1)
  })
  it('sends details as an object whose leaves are scalars, nested only by containers and lists (D9, 09 §19.1), and the list newest first (D1)', async () => {
    const response = await fetch(`${origin}/api/v1/admin/audit-events?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: { id: string; occurredAt: string; details: unknown }[] }
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(item.details !== null && typeof item.details === 'object' && !Array.isArray(item.details)).toBe(true)
      // Every leaf, at any depth, is a string, a number, a boolean or null: never a payload, a hash or a secret blob.
      for (const [, leaf] of leavesOf(item.details)) expect(leaf === null || ['string', 'number', 'boolean'].includes(typeof leaf)).toBe(true)
    }
    for (let index = 1; index < body.items.length; index += 1) {
      const previous = body.items[index - 1]!
      const current = body.items[index]!
      // The direction of the id tie-breaker is not stated in D1, so only the time order is asserted.
      expect(Date.parse(previous.occurredAt)).toBeGreaterThanOrEqual(Date.parse(current.occurredAt))
      expect(previous.id).not.toBe(current.id)
    }

    const parsed = await createHttpAuditGateway(options).listAuditEvents(token, { limit: 100 })
    expect(parsed.kind).toBe('ok')
    if (parsed.kind !== 'ok') return
    // The parsed view keeps every scalar leaf the server sent, under its path, and shows nothing the server did not send.
    // A null that stands for an absent container (`from: null` of a first placement) is nothing to show.
    parsed.value.items.forEach((event, index) => {
      const sent = leavesOf(body.items[index]?.details)
      expect(event.details.omitted).toBe(0)
      expect(Object.fromEntries(event.details.entries.filter(([, value]) => value !== null))).toEqual(Object.fromEntries(sent.filter(([, value]) => value !== null)))
      const sentNulls = new Set(sent.filter(([, value]) => value === null).map(([path]) => path))
      for (const [path, value] of event.details.entries) if (value === null) expect(sentNulls.has(path)).toBe(true)
    })
  })
  it('reports a forged cursor as INVALID_CURSOR, not as an empty history', async () => {
    const result = await createHttpAuditGateway(options).listAuditEvents(token, { limit: 10, cursor: 'not-a-cursor' })
    expect(result.kind === 'httpProblem' && [result.status, result.problem?.code]).toEqual([400, 'INVALID_CURSOR'])
  })
  it('reports an inverted period as a 400 problem, not as data', async () => {
    const result = await createHttpAuditGateway(options).listAuditEvents(token, { from: '2026-11-11T00:00:00Z', to: '2026-11-10T00:00:00Z', limit: 10 })
    expect(result.kind === 'httpProblem' && result.status).toBe(400)
  })
})
