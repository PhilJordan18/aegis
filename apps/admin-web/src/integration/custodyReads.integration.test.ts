import { beforeAll, describe, expect, it } from 'vitest'
import { createHttpTransactionGateway } from '../features/transactions/httpTransactionGateway'

/**
 * Opt-in check of the Web parsers against a running, isolated Aegis API (never staging or the hub). Skipped unless
 * AEGIS_IT_API_ORIGIN, AEGIS_IT_ADMIN_EMAIL and AEGIS_IT_ADMIN_PASSWORD are set. It only reads.
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

describe.skipIf(!origin || !email || !password)('§17 custody reads against an isolated API', () => {
  const options = { baseUrl: origin }
  // One sign-in for the whole file: the login route is rate limited (09 §10.2).
  let token = ''
  beforeAll(async () => {
    token = await signIn()
  })

  it('parses the §17 reservation and loan lists the server returns', async () => {
    const gateway = createHttpTransactionGateway(options)
    const reservations = await gateway.listReservations(token, { page: 0, size: 20 })
    const loans = await gateway.listLoans(token, { page: 0, size: 20 })
    expect(reservations.kind).toBe('ok')
    expect(loans.kind).toBe('ok')
  })

  it('parses the §17 locker-operation list the server returns', async () => {
    const operations = await createHttpTransactionGateway(options).listLockerOperations(token, { page: 0, size: 20 })
    expect(operations.kind).toBe('ok')
  })
})
