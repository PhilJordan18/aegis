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
  it('reports a forged cursor as INVALID_CURSOR, not as an empty history', async () => {
    const result = await createHttpAuditGateway(options).listAuditEvents(token, { limit: 10, cursor: 'not-a-cursor' })
    expect(result.kind === 'httpProblem' && [result.status, result.problem?.code]).toEqual([400, 'INVALID_CURSOR'])
  })
  it('reports an inverted period as a 400 problem, not as data', async () => {
    const result = await createHttpAuditGateway(options).listAuditEvents(token, { from: '2026-11-11T00:00:00Z', to: '2026-11-10T00:00:00Z', limit: 10 })
    expect(result.kind === 'httpProblem' && result.status).toBe(400)
  })
})
