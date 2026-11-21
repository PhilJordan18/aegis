import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalScroll } from './support.ts'

/**
 * Browser acceptance of the Manager custody screens against a REAL Aegis Control API (project `realapi`,
 * npm run test:realapi). Opt-in: playwright.config.ts declares the project only when AEGIS_E2E_REAL_API=1.
 *
 * What it proves, in French and English at 1280 and 390 px, from the real login form (browser session, ADR-016):
 * Vue d'ensemble, Réservations et prêts (reservations, loans and operations views), Anomalies and Audit load what the
 * API returned (the number a page shows is the `totalItems` of the response it made, or the length of the audit page),
 * the shell links reach each screen by clicking, a full reload keeps the session, axe WCAG 2.2 A/AA reports nothing,
 * and `aegis://local-access` never reaches the page text. It is read-only: the only non-GET requests allowed are the
 * sign-in and the session restoration, and the last test of each walk fails on any other. It never acknowledges an
 * anomaly and never emits a command.
 *
 * It finds things by role, address, form field name and count, not by French or English copy, so a label change does
 * not break it and the same walk runs in both languages. The language is the browser's, as for a visitor.
 *
 * Stack and credentials: an isolated stack only, never staging or production. AEGIS_E2E_BASE_URL is a `vite preview`
 * of the production build on `localhost` (the origin AEGIS_WEB_ALLOWED_ORIGINS names), AEGIS_E2E_ADMIN_EMAIL and
 * AEGIS_E2E_ADMIN_PASSWORD an administrator of that stack. Nothing is written to a file, a log or the report.
 * AEGIS_E2E_REQUIRE_DATA names the views that must not be empty so an empty stack cannot pass vacuously:
 * a comma list of reservations, loans, operations, anomalies, audit (default: audit). A view not listed may be empty
 * and is then proven by its zero count and the absence of any alert, which is the page's answer to a successful
 * empty response, not a failure.
 */
const ADMIN_EMAIL = process.env.AEGIS_E2E_ADMIN_EMAIL ?? ''
const ADMIN_PASSWORD = process.env.AEGIS_E2E_ADMIN_PASSWORD ?? ''
const REQUIRED = new Set((process.env.AEGIS_E2E_REQUIRE_DATA ?? 'audit').split(',').map((name) => name.trim()).filter(Boolean))
const SECRET_SCHEME = 'aegis://local-access'
const API = '/api/v1'

interface ApiCall {
  readonly method: string
  readonly path: string
  readonly search: URLSearchParams
  readonly status: number
  readonly response: Response
}

interface Walk {
  readonly page: Page
  readonly calls: ApiCall[]
  readonly lang: 'fr' | 'en'
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844 },
] as const

const LOCALES = [
  { lang: 'fr', tag: 'fr-CA' },
  { lang: 'en', tag: 'en-CA' },
] as const

/** Sign-in and the restoration of a session are the only writes a walk may make (ADR-016). */
const ALLOWED_WRITES = new Set([`POST ${API}/auth/login`, `POST ${API}/auth/session/refresh`])

function watch(page: Page): ApiCall[] {
  const calls: ApiCall[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith(`${API}/`)) return
    calls.push({ method: response.request().method(), path: url.pathname, search: url.searchParams, status: response.status(), response })
  })
  return calls
}

/** The first answer to a request of `path`, optionally with the query parameters given. */
function firstCall(calls: readonly ApiCall[], method: string, path: string, params: Readonly<Record<string, string>> = {}): ApiCall | undefined {
  return calls.find((call) => call.method === method && call.path === `${API}${path}` && Object.entries(params).every(([key, value]) => call.search.get(key) === value))
}

/** Waits for a read the page makes after an action (a selection, a first paint): it answers a moment later. */
async function waitForCall(calls: readonly ApiCall[], mark: number, method: string, path: string): Promise<ApiCall | undefined> {
  // `calls` keeps growing while the page works: slice it again at each poll.
  await expect.poll(() => firstCall(calls.slice(mark), method, path) !== undefined, { message: `${method} ${path}`, timeout: 10_000 }).toBe(true)
  return firstCall(calls.slice(mark), method, path)
}

async function jsonOf(call: ApiCall | undefined, what: string): Promise<Record<string, unknown>> {
  expect(call, `${what}: the page asked for it`).toBeDefined()
  expect(call?.status, `${what}: HTTP status`).toBe(200)
  return (await call!.response.json()) as Record<string, unknown>
}

function itemsOf(body: Record<string, unknown>): { id: string }[] {
  expect(Array.isArray(body.items), 'a list response has items').toBe(true)
  return body.items as { id: string }[]
}

/** A region (the list) whose accessible name starts with this count, in either language. */
function regionCounting(page: Page, count: number): Locator {
  return page.getByRole('region', { name: new RegExp(`^${count}\\b`) })
}

/** Reaches a screen by clicking its shell link, in the menu dialog below 1024 px and in the sidebar above. */
async function openSection(walk: Walk, path: string) {
  const { page } = walk
  const menu = page.locator('button[aria-haspopup="dialog"]')
  if (await menu.isVisible()) await menu.click()
  await page.locator(`a[href="${path}"]:visible`).click()
  await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`))
}

/** Settled: a page heading, nothing busy, no alert in the page, no API answer of 400 or more since `mark`. */
async function expectSettled(walk: Walk, mark: number) {
  const { page, calls, lang } = walk
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
  const failed = calls.slice(mark).filter((call) => call.status >= 400).map((call) => `${call.method} ${call.path} ${call.status}`)
  expect(failed, 'API answers of 400 or more').toEqual([])
  await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang}`))
}

async function expectCleanScreen(page: Page) {
  const text = await page.evaluate(() => document.body.innerText)
  expect(text.includes(SECRET_SCHEME), `${SECRET_SCHEME} in the page text`).toBe(false)
  await expectNoHorizontalScroll(page)
  await expectNoAxeViolations(page)
}

/** Selects the second row (a link, so a GET); the caller checks that its dossier was read. */
async function selectSecondRow(region: Locator) {
  const links = region.getByRole('listitem').getByRole('link')
  await links.nth(1).click()
  await expect(links.nth(1)).toHaveAttribute('aria-current', 'true')
}

const VIEWS = [
  { view: 'reservations', href: '/reservations-prets', endpoint: '/admin/reservations' },
  { view: 'loans', href: '/reservations-prets?vue=prets', endpoint: '/admin/loans' },
  { view: 'operations', href: '/reservations-prets?vue=operations', endpoint: '/admin/locker-operations' },
] as const

function describeWalk(lang: 'fr' | 'en', tag: string, viewport: (typeof VIEWPORTS)[number]) {
  test.describe.serial(`${lang} ${viewport.name}px`, () => {
    let context: BrowserContext
    let walk: Walk

    test.beforeAll(async ({ browser }: { browser: Browser }) => {
      expect(ADMIN_EMAIL && ADMIN_PASSWORD, 'AEGIS_E2E_ADMIN_EMAIL and AEGIS_E2E_ADMIN_PASSWORD must be set').toBeTruthy()
      context = await browser.newContext({
        baseURL: process.env.AEGIS_E2E_BASE_URL,
        locale: tag,
        timezoneId: 'America/Toronto',
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      walk = { page, calls: watch(page), lang }
    })

    test.afterAll(async () => {
      await context.close()
    })

    test('signs in through the real form and reaches the Manager', async () => {
      test.setTimeout(180_000)
      const { page } = walk
      // 5 attempts a minute per address and account (services/api/README.md): a 429 is waited out, as the API asks.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.goto('/connexion')
        await page.locator('input[name="email"]').fill(ADMIN_EMAIL)
        await page.locator('input[name="password"]').fill(ADMIN_PASSWORD)
        const login = page.waitForResponse((response) => response.url().endsWith(`${API}/auth/login`))
        await page.locator('form button[type="submit"]').click()
        const response = await login
        if (response.status() === 200) break
        expect(response.status(), 'sign-in answer').toBe(429)
        await page.waitForTimeout((Number(response.headers()['retry-after'] ?? '60') + 1) * 1000)
      }
      await expect(page).toHaveURL(/\/equipements$/)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })

    test("Vue d'ensemble shows the counts the API returned", async () => {
      const { page, calls } = walk
      const mark = calls.length
      await openSection(walk, '/vue-d-ensemble')
      await expectSettled(walk, mark)

      const anomalies = await jsonOf(firstCall(calls.slice(mark), 'GET', '/admin/anomalies', { status: 'OPEN' }), 'open anomalies')
      const reservations = await jsonOf(firstCall(calls.slice(mark), 'GET', '/admin/reservations', { status: 'ACTIVE' }), 'active reservations')
      // Five blocks in the order of the design (anomalies, loans, locker, operations, reservations), each a titled region.
      const blocks = page.locator('main section[aria-labelledby]')
      await expect(blocks).toHaveCount(5)
      // A block shows the server's count, or its "none" sentence when the count is zero: the digit is the check.
      const anomalyTotal = anomalies.totalItems as number
      const reservationTotal = reservations.totalItems as number
      if (anomalyTotal > 0) await expect(blocks.nth(0)).toContainText(String(anomalyTotal))
      if (reservationTotal > 0) await expect(blocks.nth(4)).toContainText(String(reservationTotal))
      if (REQUIRED.has('reservations')) expect(reservationTotal, 'active reservations on this stack (AEGIS_E2E_REQUIRE_DATA)').toBeGreaterThan(0)
      if (REQUIRED.has('anomalies')) expect(anomalyTotal, 'open anomalies on this stack (AEGIS_E2E_REQUIRE_DATA)').toBeGreaterThan(0)
      // Its other reads were made and answered 200 (a failed one would be an alert, and is listed above).
      for (const prefix of ['/admin/loans', '/admin/locker-operations', '/lockers']) {
        const answered = calls.slice(mark).filter((call) => call.method === 'GET' && call.path.startsWith(`${API}${prefix}`) && call.status === 200)
        expect(answered.length, `${prefix} reads`).toBeGreaterThan(0)
      }
      await expectCleanScreen(page)
    })

    for (const { view, href, endpoint } of VIEWS) {
      test(`Réservations et prêts, ${view} view, shows the page the API returned`, async () => {
        const { page, calls } = walk
        const mark = calls.length
        if (view === 'reservations') await openSection(walk, '/reservations-prets')
        else {
          const tab = page.locator(`main nav a[href="${href}"]`)
          await tab.click()
          await expect(tab).toHaveAttribute('aria-current', 'page')
        }
        await expectSettled(walk, mark)

        const list = await jsonOf(firstCall(calls.slice(mark), 'GET', endpoint, { page: '0' }), `${view} list`)
        const total = list.totalItems as number
        const items = itemsOf(list)
        if (REQUIRED.has(view)) expect(total, `${view} on this stack (AEGIS_E2E_REQUIRE_DATA)`).toBeGreaterThan(0)

        // The list title carries the server's total; with no result the list has no row and the page no alert.
        const region = regionCounting(page, total)
        await expect(region).toBeVisible()
        await expect(region.getByRole('listitem').getByRole('link')).toHaveCount(items.length)
        if (total > 0) {
          // The first row is open by default: its dossier is a second real read, and it answered.
          await jsonOf(await waitForCall(calls, mark, 'GET', `${endpoint}/${items[0]!.id}`), `${view} dossier`)
          await expectCleanScreen(page)
          if (items.length > 1) {
            await selectSecondRow(region)
            await jsonOf(await waitForCall(calls, mark, 'GET', `${endpoint}/${items[1]!.id}`), `${view} second dossier`)
            await page.waitForLoadState('networkidle')
            await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
          }
        }
        await expectCleanScreen(page)
      })
    }

    test('Anomalies shows the page the API returned', async () => {
      const { page, calls } = walk
      const mark = calls.length
      await openSection(walk, '/anomalies')
      await expectSettled(walk, mark)

      const list = await jsonOf(firstCall(calls.slice(mark), 'GET', '/admin/anomalies', { page: '0' }), 'anomalies list')
      const total = list.totalItems as number
      const items = itemsOf(list)
      if (REQUIRED.has('anomalies')) expect(total, 'anomalies on this stack (AEGIS_E2E_REQUIRE_DATA)').toBeGreaterThan(0)
      const region = regionCounting(page, total)
      await expect(region).toBeVisible()
      await expect(region.getByRole('listitem').getByRole('link')).toHaveCount(items.length)
      if (total > 0) {
        await jsonOf(await waitForCall(calls, mark, 'GET', `/admin/anomalies/${items[0]!.id}`), 'anomaly dossier')
        await expectCleanScreen(page)
        if (items.length > 1) await selectSecondRow(region)
      }
      await expectCleanScreen(page)
    })

    test('Audit shows the events the API returned', async () => {
      const { page, calls } = walk
      const mark = calls.length
      await openSection(walk, '/audit')
      await expectSettled(walk, mark)

      const body = await jsonOf(firstCall(calls.slice(mark), 'GET', '/admin/audit-events'), 'audit first page')
      const items = itemsOf(body)
      if (REQUIRED.has('audit')) expect(items.length, 'audit events on this stack (AEGIS_E2E_REQUIRE_DATA)').toBeGreaterThan(0)
      // The title counts the events loaded so far: the first page.
      const region = regionCounting(page, items.length)
      await expect(region).toBeVisible()
      await expect(region.getByRole('listitem').getByRole('link')).toHaveCount(items.length)
      await expectCleanScreen(page)
    })

    test('a full reload keeps the session on every screen', async () => {
      const { page, calls } = walk
      for (const path of ['/audit', '/anomalies', '/reservations-prets', '/vue-d-ensemble']) {
        if (new URL(page.url()).pathname !== path) await openSection(walk, path)
        const mark = calls.length
        await page.reload()
        await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`))
        await expectSettled(walk, mark)
        // The page was reloaded: its token is gone, and the HttpOnly cookie restored the session once.
        expect(firstCall(calls.slice(mark), 'POST', '/auth/session/refresh')?.status, `POST /auth/session/refresh on ${path}`).toBe(200)
        await expect(page.locator('input[name="password"]')).toHaveCount(0)
      }
    })

    test("a loans-view address survives a reload, and the shell reaches Vue d'ensemble by click", async () => {
      const { page, calls } = walk
      await openSection(walk, '/reservations-prets')
      await page.locator('main nav a[href="/reservations-prets?vue=prets"]').click()
      await expect(page).toHaveURL(/vue=prets/)
      const mark = calls.length
      await page.reload()
      await expectSettled(walk, mark)
      await expect(page.locator('main nav a[href="/reservations-prets?vue=prets"]')).toHaveAttribute('aria-current', 'page')
      await openSection(walk, '/vue-d-ensemble')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })

    test('the whole walk made no write other than signing in and restoring the session', async () => {
      const writes = walk.calls.filter((call) => call.method !== 'GET' && call.method !== 'HEAD').map((call) => `${call.method} ${call.path}`)
      expect(writes.filter((write) => !ALLOWED_WRITES.has(write)), 'unexpected writes').toEqual([])
      expect(writes.some((write) => write.includes('/commands') || write.includes('/acknowledge')), 'command or acknowledgement').toBe(false)
    })
  })
}

for (const { lang, tag } of LOCALES) {
  for (const viewport of VIEWPORTS) describeWalk(lang, tag, viewport)
}
