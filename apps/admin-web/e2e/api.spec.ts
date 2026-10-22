import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * WEB-01 acceptance against the real Aegis Control API (playwright.api.config.ts).
 * Nothing here is skipped: missing credentials or an unreachable API fail the
 * run. Passwords come from the environment only and are never printed.
 */
const ADMIN_EMAIL = process.env.AEGIS_DEMO_ADMIN_EMAIL ?? 'admin@aegis.demo'
const TECHNICIAN_EMAIL = process.env.AEGIS_DEMO_TECHNICIAN_EMAIL ?? 'technician@aegis.demo'
const ADMIN_PASSWORD = process.env.AEGIS_DEMO_ADMIN_PASSWORD ?? ''
const TECHNICIAN_PASSWORD = process.env.AEGIS_DEMO_TECHNICIAN_PASSWORD ?? ''

/** A fresh address per test, so its attempts never share a rate-limit window with the demo accounts. */
function unknownAccount(): string {
  return `inconnu-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aegis.demo`
}

function apiRequests(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request)
  })
  return requests
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Adresse courriel').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

test.beforeAll(async ({ request }) => {
  expect(ADMIN_PASSWORD && TECHNICIAN_PASSWORD, 'demo passwords must be set for the acceptance run').toBeTruthy()
  // Through the preview server's proxy: proves the same path the browser uses.
  const health = await request.get('/api/v1/system/health')
  expect(health.ok(), 'Aegis Control API reachable through the /api proxy').toBe(true)
})

test.beforeEach(async ({ page }) => {
  await page.goto('/connexion')
  // Production build: the design-review preview is absent.
  await expect(page.getByRole('region', { name: 'Mode aperçu' })).toHaveCount(0)
})

test('an administrator signs in, reaches the Manager shell, and the token stays in memory', async ({ page }) => {
  const requests = apiRequests(page)
  const login = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'))
  const me = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/me'))
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)

  const loginResponse = await login
  expect(loginResponse.status()).toBe(200)
  const { user } = (await loginResponse.json()) as { user: { displayName: string; role: string } }
  expect(user.role).toBe('ADMIN')

  await expect(page).toHaveURL(/\/equipements$/)
  await expect(page).toHaveTitle('Équipements — Aegis Manager')
  await expect(page.getByRole('heading', { level: 1, name: 'Équipements' })).toBeFocused()
  const sections = page.getByRole('navigation', { name: 'Sections' })
  await expect(sections.getByRole('link', { name: 'Équipements' })).toHaveAttribute('aria-current', 'page')
  await expect(sections.getByRole('button', { name: new RegExp(user.displayName) })).toBeVisible()

  const meResponse = await me
  expect(meResponse.status()).toBe(200)
  const meRequest = requests.find((request) => request.url().endsWith('/api/v1/auth/me'))
  expect(await meRequest?.headerValue('authorization')).toMatch(/^Bearer \S+$/)
  expect(meResponse.headers()['x-request-id']).toBeTruthy()

  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }))
  expect(storage).toEqual({ local: {}, session: {}, cookie: '' })

  await sections.getByRole('button', { name: new RegExp(user.displayName) }).click()
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('status').filter({ hasText: 'Vous êtes déconnecté.' })).toBeVisible()

  // The token is gone: the protected page sends back to sign-in without calling the API.
  const before = requests.length
  await page.goto('/equipements')
  await expect(page).toHaveURL(/\/connexion$/)
  expect(requests.slice(before)).toEqual([])
})

test('a technician account is refused, its token is dropped and no request follows', async ({ page }) => {
  const requests = apiRequests(page)
  const login = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'))
  await signIn(page, TECHNICIAN_EMAIL, TECHNICIAN_PASSWORD)
  expect((await login).status()).toBe(200)

  await expect(page.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeFocused()
  await expect(page.getByRole('alert')).toContainText("Ce compte technicien s'utilise dans Aegis Mobile.")
  await expect(page.locator('form')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(requests.map((request) => new URL(request.url()).pathname)).toEqual(['/api/v1/auth/login'])
  await expect(page).toHaveURL(/\/connexion$/)
})

test('an unknown account receives the invalid-credentials state', async ({ page }) => {
  const email = unknownAccount()
  await signIn(page, email, 'mot-de-passe-incorrect')
  await expect(page.getByRole('alert')).toContainText('Adresse courriel ou mot de passe incorrect.')
  await expect(page.getByLabel('Mot de passe', { exact: true })).toBeFocused()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Adresse courriel')).toHaveValue(email)
})

test('a server validation error is shown on the password field', async ({ page }) => {
  const response = page.waitForResponse((candidate) => candidate.url().endsWith('/api/v1/auth/login'))
  // Accepted by the client, rejected by the server: more than 72 bytes (09 §10.2).
  await signIn(page, unknownAccount(), 'x'.repeat(73))
  expect((await response).status()).toBe(400)
  await expect(page.getByText("Ce mot de passe n'est pas accepté. Vérifiez-le, puis réessayez.")).toBeVisible()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('aria-invalid', 'true')
})

test('repeated attempts reach the rate limit and use its Retry-After delay', async ({ page }) => {
  const email = unknownAccount()
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await signIn(page, email, `mot-de-passe-incorrect-${attempt}`)
    await expect(page.locator('form[data-state="invalidCredentials"]')).toBeVisible()
  }
  const limited = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'))
  await signIn(page, email, 'mot-de-passe-incorrect-6')
  const response = await limited
  expect(response.status()).toBe(429)
  expect(response.headers()['retry-after']).toMatch(/^\d+$/)

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Trop de tentatives.')
  await expect(alert).toContainText(/Réessayez dans \d+\s+secondes?\./)
  // The delay is shown once, in the alert: no countdown caption under the button.
  await expect(page.getByText(/\d+:\d{2}/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Se connecter' })).toHaveAttribute('aria-disabled', 'true')
})
