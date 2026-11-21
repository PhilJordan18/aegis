import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'
import { SESSION_COOKIE } from './sessionFakes.ts'

/**
 * ADR-016 acceptance against the real Aegis Control API (playwright.api.config.ts), kept apart from the
 * mocked `session.spec.ts`: here the API issues and checks the cookie. Run it only against an isolated API
 * started with AEGIS_WEB_ALLOWED_ORIGINS=http://localhost:5181, never staging. Passwords come from the
 * environment only and are never printed.
 */
const ADMIN_EMAIL = process.env.AEGIS_DEMO_ADMIN_EMAIL ?? 'admin@aegis.demo'
const TECHNICIAN_EMAIL = process.env.AEGIS_DEMO_TECHNICIAN_EMAIL ?? 'technician@aegis.demo'
const ADMIN_PASSWORD = process.env.AEGIS_DEMO_ADMIN_PASSWORD ?? ''
const TECHNICIAN_PASSWORD = process.env.AEGIS_DEMO_TECHNICIAN_PASSWORD ?? ''
const ORIGIN = 'http://localhost:5181'

function apiCalls(page: Page): Request[] {
  const calls: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request)
  })
  return calls
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Adresse courriel').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

const cookieOf = async (context: BrowserContext) => (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)

test.beforeAll(() => {
  expect(ADMIN_PASSWORD && TECHNICIAN_PASSWORD, 'demo passwords must be set for the acceptance run').toBeTruthy()
})

test('the API sets the HttpOnly cookie, a reload and a direct link restore the session, and the cookie travels only to the session routes', async ({ page, context }) => {
  test.setTimeout(150_000)
  const calls = apiCalls(page)
  await page.goto('/connexion')
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/equipements$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Équipements' })).toBeVisible()

  expect(await cookieOf(context)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/v1/auth/session' })
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }))).toEqual({ local: {}, session: {}, cookie: '' })

  const refresh = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/session/refresh'))
  await page.reload()
  expect((await refresh).status()).toBe(200)
  await expect(page).toHaveURL(/\/equipements$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Équipements' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Administrateur/ })).toBeVisible()

  await page.goto('/casiers')
  await expect(page).toHaveURL(/\/casiers$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Casiers' })).toBeVisible()

  for (const call of calls) {
    const path = new URL(call.url()).pathname
    const cookie = (await call.allHeaders()).cookie ?? ''
    if (!path.startsWith('/api/v1/auth/session')) expect(cookie, `${call.method()} ${path} must not carry the session cookie`).not.toContain(SESSION_COOKIE)
  }
  expect(calls.some((call) => new URL(call.url()).pathname === '/api/v1/auth/session/refresh')).toBe(true)
})

test('an explicit sign-out revokes the session on the server: the same cookie no longer restores it', async ({ page, context }) => {
  test.setTimeout(150_000)
  await page.goto('/connexion')
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/equipements$/)
  const issued = await cookieOf(context)
  expect(issued).toBeDefined()

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Administrateur/ }).click()
  const revoked = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/session/revoke'))
  await page.getByRole('button', { name: 'Se déconnecter' }).first().click()
  expect((await revoked).status()).toBe(204)
  await expect(page).toHaveURL(/\/connexion$/)
  expect(await cookieOf(context)).toBeUndefined()

  await page.reload()
  await expect(page.getByLabel('Adresse courriel')).toBeVisible()

  // The server, not the browser, ended the session: replaying the very cookie it issued is refused.
  await context.addCookies([{ ...issued!, expires: Date.now() / 1000 + 600 }])
  const replay = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/session/refresh'))
  await page.goto('/equipements')
  const response = await replay
  expect(response.status()).toBe(401)
  expect((await response.json()).code).toBe('AUTH_SESSION_INVALID')
  await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipements$/)
})

test('a technician is refused by the Manager and no session survives a reload', async ({ page, context }) => {
  test.setTimeout(150_000)
  await page.goto('/connexion')
  await signIn(page, TECHNICIAN_EMAIL, TECHNICIAN_PASSWORD)
  await expect(page.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(await cookieOf(context)).toBeUndefined()

  await page.goto('/equipements')
  await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipements$/)
})

test('the cookie routes refuse a missing or foreign Origin (403 FORBIDDEN) and iOS-style login sets no cookie', async ({ request }) => {
  for (const origin of [undefined, 'https://evil.example']) {
    const headers: Record<string, string> = origin === undefined ? {} : { Origin: origin }
    const refresh = await request.post('/api/v1/auth/session/refresh', { headers })
    expect(refresh.status(), `refresh with Origin ${origin}`).toBe(403)
    expect((await refresh.json()).code).toBe('FORBIDDEN')
    const revoke = await request.post('/api/v1/auth/session/revoke', { headers })
    expect(revoke.status(), `revoke with Origin ${origin}`).toBe(403)
  }
  const browserLogin = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'https://evil.example' },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, browserSession: true },
  })
  expect(browserLogin.status()).toBe(403)

  const plain = await request.post('/api/v1/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  expect(plain.status()).toBe(200)
  expect(plain.headers()['set-cookie']).toBeUndefined()

  const allowed = await request.post('/api/v1/auth/session/refresh', { headers: { Origin: ORIGIN } })
  expect(allowed.status()).toBe(401)
  expect((await allowed.json()).code).toBe('AUTH_SESSION_INVALID')
})
