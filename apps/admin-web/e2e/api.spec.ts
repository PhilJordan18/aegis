import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'

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
  // 2027-01-15T05:00:00Z is local midnight in the laboratory zone: date, time and zone are all shown.
  await expect(dossier).toContainText(/15\sjanv\.\s2027,\s00\sh\s00\sHNE/)
  await expect(dossier).toContainText('America/Toronto')
  await expect(page.locator('main')).not.toContainText(/\bPrêt\b/)
  // The only commands are create, edit and archive (CAT-01 forms), plus the search submit (#109); readiness is never a
  // control. The kept database may hold more than one page, whose pager has buttons.
  const pagerButtons = await page.getByRole('navigation', { name: 'Pagination des exemplaires' }).getByRole('button').count()
  await expect(page.locator('main').getByRole('button')).toHaveCount(pagerButtons + 4)
  await expect(page.getByRole('group', { name: 'Actions de l’exemplaire' }).getByRole('button')).toHaveText(['Modifier', 'Archiver'])

  // Clicking a listed unit selects it through the address and reads it by id.
  const first = rows.first()
  await first.click()
  await expect(page).toHaveURL(/\/equipements\?exemplaire=[0-9a-f-]{36}/)
  await expect(first).toHaveAttribute('aria-current', 'true')
})

/**
 * PHY-01 #29 acceptance: the Casiers page against the real locker status. The expectations come from a direct
 * GET of the same status in the same test, translated to the French words of the catalog: no state is
 * hard-coded, so the run is right whatever the simulator is doing. Only enumerations and « seen or never » are
 * compared, since timestamps move with every heartbeat.
 */
const DEMO_LOCKER_ID = process.env.AEGIS_DEMO_LOCKER_ID ?? 'd46a74ae-39dc-460b-8af0-38fc791b376a'
const LIVE_SHOTS = fileURLToPath(new URL('../test-results/live/', import.meta.url))

interface LiveStatus {
  lockerId: string
  code: string
  name: string
  connectionStatus: string
  lastSeenAt: string | null
  currentWindow: { timeZone: string | null; open: boolean; closesAt: string | null; nextOpensAt: string | null }
  compartments: {
    code: string
    enabled: boolean
    connectionStatus: string
    rfidReaderStatus: string
    doorState: string
    lockState: string
    lastObservedAt: string | null
  }[]
}

// Test-side translation of the contract enumerations into the words the page must show (fr.ts `lockers`).
const WORDS = {
  connection: { ONLINE: 'En ligne', OFFLINE: 'Hors ligne', UNKNOWN: 'État inconnu' },
  link: { CONNECTED: 'Connectée', DISCONNECTED: 'Déconnectée', UNKNOWN: 'Inconnue' },
  reader: { HEALTHY: 'En bon état', FAULTED: 'En défaut', UNKNOWN: 'Inconnu' },
  door: { OPEN: 'Ouverte', CLOSED: 'Fermée', UNKNOWN: 'Inconnue' },
  lock: { LOCKED: 'Verrouillée', UNLOCKED: 'Déverrouillée', UNKNOWN: 'Inconnue' },
} as const

const word = (table: Record<string, string>, value: string): string => {
  const text = table[value]
  expect(text, `the contract value ${value} has a word in this test`).toBeTruthy()
  return text as string
}

/**
 * A direct GET of the same status. It reuses the bearer token the page itself sent, so the run signs in once
 * per test: the API's in-memory rate limiter counts every login of the run.
 */
async function directStatus(request: APIRequestContext, lockerId: string, authorization: string): Promise<LiveStatus> {
  const response = await request.get(`/api/v1/lockers/${lockerId}/status`, { headers: { Authorization: authorization } })
  expect(response.status(), 'direct GET /lockers/{id}/status').toBe(200)
  return (await response.json()) as LiveStatus
}

async function expectPageShows(page: Page, status: LiveStatus) {
  const panel = page.getByRole('region', { name: new RegExp(status.code) })
  await expect(panel.getByRole('heading', { level: 2 })).toContainText(status.code)
  const chip = panel.locator('.ag-diag .ag-chip')
  await expect(chip).toHaveText(word(WORDS.connection, status.connectionStatus))
  await expect(chip.locator('svg')).toHaveCount(1)
  const signal = panel.locator('.ag-lk__signal')
  if (status.lastSeenAt === null) await expect(signal).toHaveText('Aucun signal reçu')
  else await expect(signal).toContainText('Dernier signal')

  // The window is the server's verdict, shown as sent: no schedule says so, and no zone is invented.
  const { currentWindow } = status
  if (currentWindow.open) await expect(panel).toContainText('Ouvert')
  else if (currentWindow.nextOpensAt !== null) await expect(panel).toContainText('Fermé')
  else {
    await expect(panel).toContainText("Aucun horaire d'ouverture")
    await expect(panel).not.toContainText(/Fermeture|Prochaine ouverture|Fuseau du casier/)
  }
  if (currentWindow.timeZone !== null) await expect(panel).toContainText(currentWindow.timeZone)

  // While the locker is not ONLINE, an observed cell is its last known state: the note says so and the table points to it.
  const lastKnown = status.connectionStatus !== 'ONLINE' && status.compartments.some((compartment) => compartment.lastObservedAt !== null)
  const note = panel.locator('.ag-lk__lastknown')
  if (lastKnown) {
    await expect(note).toContainText('Dernier état connu')
    await expect(panel.locator('table.ag-lk-table')).toHaveAttribute('aria-describedby', (await note.getAttribute('id')) ?? 'missing')
  } else await expect(note).toHaveCount(0)

  const rows = panel.getByRole('row')
  await expect(rows).toHaveCount(status.compartments.length + 1)
  for (const compartment of status.compartments) {
    const row = rows.filter({ has: page.getByRole('rowheader', { name: compartment.code, exact: true }) })
    await expect(row).toHaveCount(1)
    const cells = row.getByRole('cell')
    await expect(cells.nth(0)).toHaveText(new RegExp(compartment.enabled ? 'Oui$' : 'Non$'))
    await expect(cells.nth(1)).toContainText(word(WORDS.link, compartment.connectionStatus))
    await expect(cells.nth(2)).toContainText(word(WORDS.reader, compartment.rfidReaderStatus))
    await expect(cells.nth(3)).toContainText(word(WORDS.door, compartment.doorState))
    await expect(cells.nth(4)).toContainText(word(WORDS.lock, compartment.lockState))
    if (compartment.lastObservedAt === null) await expect(cells.nth(5)).toContainText('Aucune observation')
    else await expect(cells.nth(5)).not.toContainText('Aucune observation')
    if (lastKnown && compartment.lastObservedAt !== null) {
      for (const column of [1, 2, 3, 4]) await expect(cells.nth(column).locator('.ag-chip')).toHaveCount(0)
    }
  }
}

/** Every request of the page that reaches the API, as « METHOD path ». The sign-in POST is the only write allowed. */
function expectOnlyReads(requests: Request[]) {
  const writes = requests.filter((candidate) => candidate.method() !== 'GET' && !(candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/v1/auth/login'))
  expect(writes.map((candidate) => `${candidate.method()} ${new URL(candidate.url()).pathname}`), 'write requests made by the page').toEqual([])
}

test('Casiers (catalog discovery): the chip and every compartment row match a direct GET of the same status', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const requests = apiRequests(page)
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/equipements$/)
  // Through the shell link, in the same session: no reload, so the in-memory token survives.
  const statusPromise = page.waitForRequest((candidate) => /\/api\/v1\/lockers\/[^/]+\/status$/.test(new URL(candidate.url()).pathname))
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Casiers' }).click()
  await expect(page).toHaveURL(/\/casiers$/)
  await expect(page).toHaveTitle('Casiers — Aegis Manager')
  await expect(page.getByRole('heading', { level: 1, name: 'Casiers' })).toBeFocused()

  // Which locker the page found is read from its own request: the catalog placements name it.
  const statusRequest = await statusPromise
  const lockerId = new URL(statusRequest.url()).pathname.split('/').at(-2) ?? ''
  expect(lockerId).toBe(DEMO_LOCKER_ID)
  const authorization = (await statusRequest.headerValue('authorization')) ?? ''
  expect(authorization).toMatch(/^Bearer \S+$/)
  expect(requests.some((candidate) => new URL(candidate.url()).pathname === '/api/v1/admin/assets'), 'the catalog placements were read').toBe(true)

  await expect(page.locator('.ag-lk__title')).toBeVisible()
  const status = await directStatus(request, lockerId, authorization)
  await expectPageShows(page, status)

  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${LIVE_SHOTS}casiers-live-desktop-1440-light.png`, fullPage: true, animations: 'disabled' })

  // No command: the only control opens the schedule editor (CFG-02 #28), and the page wrote nothing.
  await expect(page.locator('main').getByRole('button')).toHaveText(['Modifier l’horaire'])
  expectOnlyReads(requests)
})

test('Casiers (?casier=): the named locker is read directly and matches a direct GET of the same status', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  const requests = apiRequests(page)
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page).toHaveURL(/\/equipements$/)
  const statusPromise = page.waitForRequest((candidate) => /\/api\/v1\/lockers\/[^/]+\/status$/.test(new URL(candidate.url()).pathname))
  await page.evaluate((lockerId) => {
    window.history.pushState(null, '', `/casiers?casier=${lockerId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, DEMO_LOCKER_ID)
  await expect(page.getByRole('heading', { level: 1, name: 'Casiers' })).toBeVisible()
  const statusRequest = await statusPromise
  const authorization = (await statusRequest.headerValue('authorization')) ?? ''
  expect(authorization).toMatch(/^Bearer \S+$/)
  await expect(page.locator('.ag-lk__title')).toBeVisible()

  const status = await directStatus(request, DEMO_LOCKER_ID, authorization)
  await expectPageShows(page, status)
  // Named in the address: the catalog placements are not needed for this page.
  const afterOpening = requests.filter((candidate) => /\/api\/v1\/lockers\//.test(candidate.url()))
  expect(afterOpening.length).toBeGreaterThan(0)
  expect(afterOpening.every((candidate) => candidate.url().includes(`/lockers/${DEMO_LOCKER_ID}/status`))).toBe(true)

  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${LIVE_SHOTS}casiers-live-mobile-390-dark.png`, fullPage: true, animations: 'disabled' })
  await expectNoHorizontalScrollLive(page)
  await expect(page.locator('main').getByRole('button')).toHaveText(['Modifier l’horaire'])
  expectOnlyReads(requests)
})

async function expectNoHorizontalScrollLive(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(clientWidth)
}

test('CAT-01 forms: an administrator creates, edits and archives a model and a unit through the real API', async ({ page, request }) => {
  // The suite's earlier sign-ins may fill the five-per-minute window (09 §23.4): this test waits it out.
  test.setTimeout(150_000)
  const stamp = Date.now()
  const modelName = `Formulaire E2E ${stamp}`
  const code = `FORM-${stamp}`
  const requests = apiRequests(page)
  const accessToken = await signInWhenAllowed(page)
  await expect(page).toHaveURL(/\/equipements$/)
  const auth = { Authorization: `Bearer ${accessToken}` }

  // Model: created from the Modèles tab, with the Idempotency-Key the contract requires (09 §20.1).
  await page.getByRole('link', { name: 'Modèles' }).click()
  await expect(page).toHaveURL(/vue=modeles/)
  await page.getByRole('button', { name: 'Nouveau modèle' }).click()
  const modelDialog = page.getByRole('dialog', { name: 'Nouveau modèle' })
  await expect(modelDialog.getByLabel(/^Nom/)).toBeFocused()
  await modelDialog.getByLabel(/^Nom/).fill(` ${modelName} `)
  await modelDialog.getByLabel(/^Fabricant/).fill('Fluke')
  await modelDialog.getByLabel('Calibration exigée par défaut').check()
  const modelCreated = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/admin/asset-models')
  await modelDialog.getByRole('button', { name: 'Créer' }).click()
  const modelResponse = await modelCreated
  expect(modelResponse.status()).toBe(201)
  expect(await modelResponse.request().headerValue('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
  const savedModel = (await modelResponse.json()) as { id: string; name: string; manufacturer: string; defaultCalibrationRequired: boolean }
  expect(savedModel).toMatchObject({ name: modelName, manufacturer: 'Fluke', defaultCalibrationRequired: true })
  await expect(modelDialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: `Modèle ${modelName} créé.` })).toHaveCount(1)

  // Unit: created from the Exemplaires tab with the new model; the model's default proposes calibration.
  await page.getByRole('link', { name: 'Exemplaires' }).click()
  await page.getByRole('button', { name: 'Nouvel exemplaire' }).click()
  const unitDialog = page.getByRole('dialog', { name: 'Nouvel exemplaire' })
  await unitDialog.getByLabel(/^Modèle/).selectOption({ label: modelName })
  await expect(unitDialog.getByLabel('Calibration requise')).toBeChecked()
  await unitDialog.getByLabel(/^Code de l’exemplaire/).fill(code)
  await unitDialog.getByLabel(/^Échéance de calibration/).fill('2027-01-15T09:30')
  const unitCreated = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/admin/assets')
  await unitDialog.getByRole('button', { name: 'Créer' }).click()
  const unitResponse = await unitCreated
  expect(unitResponse.status()).toBe(201)
  const unit = (await unitResponse.json()) as { id: string; calibration: { dueAt: string } }
  // 09:30 in the laboratory zone (America/Toronto, winter) is 14:30 UTC.
  expect(Date.parse(unit.calibration.dueAt)).toBe(Date.parse('2027-01-15T14:30:00Z'))
  await expect(page).toHaveURL(new RegExp(`exemplaire=${unit.id}`))
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(`${modelName} · ${code}`) })).toBeVisible()

  // A second unit with the same code: the server's conflict lands on the field, the draft stays.
  await page.getByRole('button', { name: 'Nouvel exemplaire' }).click()
  const duplicate = page.getByRole('dialog', { name: 'Nouvel exemplaire' })
  await duplicate.getByLabel(/^Modèle/).selectOption({ label: modelName })
  await duplicate.getByLabel(/^Code de l’exemplaire/).fill(code)
  await duplicate.getByLabel(/^Échéance de calibration/).fill('2027-01-15T09:30')
  await duplicate.getByRole('button', { name: 'Créer' }).click()
  await expect(duplicate.getByText('Ce code est déjà utilisé, exemplaires archivés compris.')).toBeVisible()
  await expect(duplicate.getByLabel(/^Code de l’exemplaire/)).toHaveAttribute('aria-invalid', 'true')
  await duplicate.getByRole('button', { name: 'Annuler' }).click()
  await expect(duplicate).toHaveCount(0)

  // Edit: PUT without an Idempotency-Key; the untouched calibration instant is sent back unchanged.
  await page.getByRole('button', { name: 'Modifier' }).click()
  const edit = page.getByRole('dialog', { name: `Modifier l’exemplaire ${code}` })
  await edit.getByLabel(/^Numéro de série/).fill(`SN-${stamp}`)
  await edit.getByRole('radio', { name: 'En maintenance' }).check()
  const updated = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/admin/assets/${unit.id}`)
  await edit.getByRole('button', { name: 'Enregistrer' }).click()
  const updateResponse = await updated
  expect(updateResponse.status()).toBe(200)
  expect(await updateResponse.request().headerValue('idempotency-key')).toBeNull()
  expect(updateResponse.request().postDataJSON()).toMatchObject({ serialNumber: `SN-${stamp}`, operationalStatus: 'MAINTENANCE', calibrationDueAt: unit.calibration.dueAt })
  await expect(edit).toHaveCount(0)
  await expect(page.locator('.ag-dossier')).toContainText(`SN-${stamp}`)

  // Archive the unit: a confirmation, then the dossier offers no more commands.
  await page.getByRole('group', { name: 'Actions de l’exemplaire' }).getByRole('button', { name: 'Archiver' }).click()
  const confirmUnit = page.getByRole('alertdialog')
  await expect(confirmUnit.getByRole('button', { name: 'Annuler' })).toBeFocused()
  await confirmUnit.getByRole('button', { name: 'Archiver' }).click()
  await expect(confirmUnit).toHaveCount(0)
  await expect(page.locator('.ag-dossier')).toContainText('Exemplaire archivé : ses réglages ne se modifient plus.'.replace(' :', ' :'))

  // Archive the model, now unused: from its row; an archived model offers no action.
  await page.getByRole('link', { name: 'Modèles' }).click()
  await expect(page.getByRole('heading', { level: 2, name: /modèles?$/ })).toBeVisible()
  const actions = page.getByRole('group', { name: `Actions du modèle ${modelName}` })
  const models = (await (await request.get(`/api/v1/admin/asset-models/${savedModel.id}`, { headers: auth })).json()) as { archivedAt: string | null }
  expect(models.archivedAt).toBeNull()
  if ((await actions.count()) === 0) await pageToModel(page, modelName)
  await actions.getByRole('button', { name: 'Archiver' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archiver' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(actions).toHaveCount(0)
  const archived = (await (await request.get(`/api/v1/admin/asset-models/${savedModel.id}`, { headers: auth })).json()) as { archivedAt: string | null }
  expect(archived.archivedAt).not.toBeNull()

  const posts = requests.filter((candidate) => candidate.method() === 'POST' && /\/api\/v1\/admin\//.test(candidate.url()))
  for (const post of posts) expect(await post.headerValue('idempotency-key'), post.url()).toMatch(/^[0-9a-f-]{36}$/)
})

/** Signs in through the page; a 429 is waited out with its Retry-After, then the same sign-in is sent again. */
test('CFG-02 schedule: an administrator edits the seven-day schedule of a locker and reads it back from the real API', async ({ page, request }) => {
  test.setTimeout(150_000)
  // A closing minute that changes at each run, so the PUT always records a new version (an identical PUT is a no-op).
  const minute = String(new Date().getUTCMinutes()).padStart(2, '0')
  const accessToken = await signInWhenAllowed(page)
  await expect(page).toHaveURL(/\/equipements$/)
  const auth = { Authorization: `Bearer ${accessToken}` }
  const schedulePath = `/api/v1/admin/lockers/${DEMO_LOCKER_ID}/operating-schedule`

  await page.evaluate((lockerId) => {
    window.history.pushState(null, '', `/casiers?casier=${lockerId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, DEMO_LOCKER_ID)
  await expect(page.locator('.ag-lk__title')).toBeVisible()

  // The editor reads the active version (or the not-configured answer) at each opening.
  const firstRead = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === schedulePath)
  await page.getByRole('button', { name: 'Modifier l’horaire' }).click()
  expect([200, 404]).toContain((await firstRead).status())
  const dialog = page.getByRole('dialog', { name: /Horaire d’exploitation du casier/ })
  const zone = dialog.getByRole('textbox', { name: /Fuseau horaire/ })
  await expect(zone).toBeFocused()
  const day = (name: string) => dialog.getByRole('group', { name })

  // A day closing before it opens is caught before any request.
  await zone.fill('America/Toronto')
  for (const name of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']) {
    await day(name).getByRole('checkbox', { name: 'Ouvert' }).check()
    await day(name).getByLabel(/Ouverture/).fill('07:00')
    await day(name).getByLabel(/Fermeture/).fill(`18:${minute}`)
  }
  for (const name of ['Samedi', 'Dimanche']) await day(name).getByRole('checkbox', { name: 'Ouvert' }).uncheck()
  await day('Mardi').getByLabel(/Fermeture/).fill('06:00')
  let puts = 0
  page.on('request', (sent) => {
    if (sent.method() === 'PUT' && new URL(sent.url()).pathname === schedulePath) puts += 1
  })
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(day('Mardi').getByLabel(/Fermeture/)).toHaveAttribute('aria-invalid', 'true')
  await expect(day('Mardi')).toContainText('La fermeture doit suivre l’ouverture')
  expect(puts).toBe(0)

  // An unknown zone is the server's to refuse: its violation lands on the zone field.
  await day('Mardi').getByLabel(/Fermeture/).fill(`18:${minute}`)
  await zone.fill('Mars/Olympus')
  const refused = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === schedulePath)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  expect((await refused).status()).toBe(400)
  await expect(zone).toHaveAttribute('aria-invalid', 'true')

  // A valid save: one PUT, no Idempotency-Key (09 §13), the answer is the new active version.
  await zone.fill('America/Toronto')
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === schedulePath)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  const response = await saved
  expect(response.status()).toBe(200)
  expect(await response.request().headerValue('idempotency-key')).toBeNull()
  const sent = response.request().postDataJSON() as { timeZone: string; windows: { dayOfWeek: string; enabled: boolean; opensAt: string | null; closesAt: string | null }[] }
  expect(sent.timeZone).toBe('America/Toronto')
  expect(sent.windows.map((window) => window.dayOfWeek)).toEqual(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])
  expect(sent.windows[1]).toEqual({ dayOfWeek: 'TUESDAY', enabled: true, opensAt: '07:00:00', closesAt: `18:${minute}:00` })
  expect(sent.windows[5]).toEqual({ dayOfWeek: 'SATURDAY', enabled: false, opensAt: null, closesAt: null })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Modifier l’horaire' })).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'Horaire du casier AEGIS-DEMO-01 enregistré.' })).toHaveCount(1)

  // A direct read returns what was sent, and the panel shows the server's window in the locker's zone.
  const direct = await request.get(schedulePath, { headers: auth })
  expect(direct.status()).toBe(200)
  const active = (await direct.json()) as { timeZone: string; windows: unknown[] }
  expect(active.timeZone).toBe('America/Toronto')
  expect(active.windows).toEqual(sent.windows)
  await expect(page.locator('.ag-lk__window')).toContainText(/Fuseau du casier\s: America\/Toronto/)

  // Opening again reads the saved version back.
  const reread = page.waitForResponse((answer) => answer.request().method() === 'GET' && new URL(answer.url()).pathname === schedulePath)
  await page.getByRole('button', { name: 'Modifier l’horaire' }).click()
  expect((await reread).status()).toBe(200)
  await expect(day('Mardi').getByLabel(/Fermeture/)).toHaveValue(`18:${minute}`)
  await expect(day('Samedi').getByRole('checkbox', { name: 'Ouvert' })).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialog).toHaveCount(0)
  expect(puts).toBe(2)
})

async function signInWhenAllowed(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const login = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'))
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const response = await login
    if (response.status() === 200) return ((await response.json()) as { accessToken: string }).accessToken
    expect(response.status()).toBe(429)
    const seconds = Number(response.headers()['retry-after'] ?? '60')
    await page.waitForTimeout((seconds + 1) * 1000)
    await page.goto('/connexion')
  }
  throw new Error('sign-in still rate limited')
}

/** Models are sorted by name; on a database with many models the new one may be on a later page. */
async function pageToModel(page: Page, name: string) {
  for (let step = 0; step < 50; step += 1) {
    if ((await page.getByRole('group', { name: `Actions du modèle ${name}` }).count()) > 0) return
    const next = page.getByRole('navigation', { name: 'Pagination des modèles' }).getByRole('button', { name: 'Suivant' })
    if ((await next.count()) === 0 || (await next.getAttribute('aria-disabled')) === 'true') return
    await next.click()
    await page.waitForLoadState('networkidle')
  }
}

interface CorpusPart {
  readonly text: string
  readonly times?: number
}
interface CorpusCase {
  readonly id: string
  readonly parts: readonly CorpusPart[]
  readonly trimmed?: readonly CorpusPart[]
  readonly result: 'VALID' | 'SIZE' | 'INVALID_VALUE'
}
const CORPUS = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/cahier-conception/09-corpus-recherche-q.json', import.meta.url)), 'utf8')) as {
  readonly cases: readonly CorpusCase[]
}
const joinParts = (parts: readonly CorpusPart[]) => parts.map((part) => part.text.repeat(part.times ?? 1)).join('')

test('search q (09 §22.3, ADR-014): the API agrees with the Web reading of every corpus case, and the page filters through it', async ({ page, request }) => {
  test.setTimeout(150_000)
  const stamp = Date.now()
  const requests = apiRequests(page)
  const accessToken = await signInWhenAllowed(page)
  await expect(page).toHaveURL(/\/equipements$/)
  const auth = { Authorization: `Bearer ${accessToken}` }

  // Each case as the Web client handles it: a VALID case is sent trimmed (searchText.test.ts proves this reading),
  // a refused one is never sent, so the raw input goes straight to the API, which must refuse it with the same code.
  expect(CORPUS.cases).toHaveLength(44)
  for (const entry of CORPUS.cases) {
    const sent = entry.result === 'VALID' ? joinParts(entry.trimmed ?? entry.parts) : joinParts(entry.parts)
    const response = await request.get('/api/v1/admin/assets', { headers: auth, params: { q: sent, size: '1' } })
    if (entry.result === 'VALID') {
      expect(response.status(), entry.id).toBe(200)
    } else {
      expect(response.status(), entry.id).toBe(400)
      const problem = (await response.json()) as { code: string; violations?: { field: string; code: string }[] }
      expect(problem.code, entry.id).toBe('VALIDATION_ERROR')
      expect(problem.violations?.map(({ field, code }) => ({ field, code })), entry.id).toEqual([{ field: 'q', code: entry.result }])
    }
  }

  // The page: a unit of this run, found by a padded, mixed-case search, with q sent trimmed and kept in the address.
  const code = `SRCH-${stamp}`
  const model = await request.post('/api/v1/admin/asset-models', {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: { name: `Recherche E2E ${stamp}`, manufacturer: null, modelNumber: null, description: null, defaultCalibrationRequired: false },
  })
  expect(model.status()).toBe(201)
  const { id: assetModelId } = (await model.json()) as { id: string }
  const created = await request.post('/api/v1/admin/assets', {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: { assetModelId, assetCode: code, serialNumber: null, requiredAccessLevel: 'STANDARD', operationalStatus: 'SERVICEABLE', calibrationRequired: false, calibrationDueAt: null },
  })
  expect(created.status()).toBe(201)

  const search = page.getByRole('search', { name: 'Rechercher un exemplaire' })
  const listed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/assets' && new URL(response.url()).searchParams.has('q'))
  await search.getByRole('searchbox').fill(`\u3000 ${code.toLowerCase()}\u00A0`)
  await search.getByRole('button', { name: 'Rechercher' }).click()
  const response = await listed
  expect(response.status()).toBe(200)
  expect(new URL(response.url()).searchParams.getAll('q')).toEqual([code.toLowerCase()])
  await expect(page).toHaveURL(new RegExp(`recherche=${code.toLowerCase()}`))
  await expect(page.getByRole('heading', { level: 2, name: '1 exemplaire' })).toBeVisible()
  await expect(page.locator('.ag-list__items a')).toHaveCount(1)
  await expect(page.locator('.ag-list__items a').first()).toContainText(code)

  // A refused search stays on the page: no request carries it.
  const before = requests.length
  await search.getByRole('searchbox').fill('a'.repeat(101))
  await search.getByRole('button', { name: 'Rechercher' }).click()
  await expect(search.getByRole('searchbox')).toBeFocused()
  await expect(search.getByRole('searchbox')).toHaveAttribute('aria-invalid', 'true')
  expect(requests.slice(before).filter((candidate) => new URL(candidate.url()).searchParams.get('q')?.startsWith('aaa'))).toEqual([])

  // Tout afficher drops q (the unfiltered first page may come from the query cache, read at sign-in).
  await search.getByRole('button', { name: 'Tout afficher' }).click()
  await expect(page).not.toHaveURL(/recherche=/)
  await expect(search.getByRole('searchbox')).toHaveValue('')
  await expect(search.getByRole('button', { name: 'Tout afficher' })).toHaveCount(0)
  await expect(page.locator('.ag-list__items a').first()).toBeVisible()
})
