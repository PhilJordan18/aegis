import { randomUUID } from 'node:crypto'
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

test('an administrator opens Équipements, sees the units from the API and opens one', async ({ page, request }) => {
  // The API holds no seed: this run registers its own unit (document 09 §12.1-12.2), through the same proxy.
  const login = await request.post('/api/v1/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
  expect(login.status()).toBe(200)
  const { accessToken } = (await login.json()) as { accessToken: string }
  const headers = () => ({ Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': randomUUID() })
  // Unique per run: model names are unique among active models, and the database outlives the run.
  const stamp = Date.now()
  const code = `E2E-${stamp}`
  const modelName = `Multimètre E2E ${stamp}`
  const model = await request.post('/api/v1/admin/asset-models', {
    headers: headers(),
    data: { name: modelName, manufacturer: 'Fluke', modelNumber: '117', description: null, defaultCalibrationRequired: true },
  })
  expect(model.status()).toBe(201)
  const { id: assetModelId } = (await model.json()) as { id: string }
  const created = await request.post('/api/v1/admin/assets', {
    headers: headers(),
    data: { assetModelId, assetCode: code, serialNumber: null, requiredAccessLevel: 'STANDARD', operationalStatus: 'SERVICEABLE', calibrationRequired: true, calibrationDueAt: '2027-01-15T05:00:00Z' },
  })
  expect(created.status()).toBe(201)
  const unit = (await created.json()) as { id: string }

  const requests = apiRequests(page)
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/equipements$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Équipements' })).toBeFocused()

  // The list comes from GET /admin/assets with the bearer token; the first unit is selected and read by id.
  await expect(page.getByRole('heading', { level: 2, name: /^\d+ exemplaires?$/ })).toBeVisible()
  const rows = page.locator('.ag-list__items a')
  await expect(rows.first()).toBeVisible()
  await expect(rows.first()).toHaveAttribute('aria-current', 'true')
  const listRequest = requests.find((candidate) => new URL(candidate.url()).pathname === '/api/v1/admin/assets')
  expect(listRequest, 'GET /admin/assets').toBeTruthy()
  expect(await listRequest?.headerValue('authorization')).toMatch(/^Bearer \S+$/)

  // Opens the unit this run created: the address carries its id, and its dossier is read from /admin/assets/{id}.
  // On an empty database that unit is also the first one, already selected and read; a cached read is not repeated.
  await page.evaluate((assetId) => {
    window.history.pushState(null, '', `/equipements?exemplaire=${assetId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, unit.id)
  await expect(page).toHaveURL(new RegExp(`exemplaire=${unit.id}$`))
  const detailPath = `/api/v1/admin/assets/${unit.id}`
  await expect.poll(() => requests.some((candidate) => new URL(candidate.url()).pathname === detailPath)).toBe(true)
  const detail = requests.find((candidate) => new URL(candidate.url()).pathname === detailPath)
  expect((await detail?.response())?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(`${modelName} · ${code}`) })).toBeVisible()

  // What the API says today: no presence observation, so no presence, no placement and no « Prêt ».
  const dossier = page.getByRole('group', { name: new RegExp(code) })
  await expect(dossier).toContainText('État physique inconnu')
  await expect(dossier).toContainText("Aucune observation de présence n'est disponible.")
  await expect(dossier).toContainText('Aucun placement connu')
  await expect(dossier).toContainText('Fluke 117')
  await expect(page.locator('main')).not.toContainText(/\bPrêt\b/)
  // Read-only: no create, edit or archive control. The kept database may hold more than one page, whose pager has buttons.
  const pagerButtons = await page.getByRole('navigation', { name: 'Pagination des exemplaires' }).getByRole('button').count()
  await expect(page.locator('main').getByRole('button')).toHaveCount(pagerButtons)

  // Clicking a listed unit selects it through the address and reads it by id.
  const first = rows.first()
  await first.click()
  await expect(page).toHaveURL(/\/equipements\?exemplaire=[0-9a-f-]{36}/)
  await expect(first).toHaveAttribute('aria-current', 'true')
})
