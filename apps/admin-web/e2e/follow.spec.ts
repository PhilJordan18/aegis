import { expect, test, type Page, type Route } from '@playwright/test'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * ADR-006 follow-up of the open operation dossier (gap R5), offline on routed fakes: the browser never reaches an API.
 * The fake server holds one operation whose status the test changes the way the backend would; the dossier must show
 * each change without a click, keep its request count bounded, pause while the tab is hidden and stop at a terminal
 * status. The run against the real API is a separate acceptance, not part of this file.
 */
const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'
const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const LOCKER_ID = '3d4e5f60-7182-4a93-8ba4-c5d6e7f80912'
const COMPARTMENT_ID = '4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b'
const RESERVATION_ID = '7b726e56-2a19-44de-887b-d3e2bfc8bf28'
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const TERMINAL = ['CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY']

const operation = (status: string) => ({
  id: OPERATION_ID,
  type: 'CHECKOUT',
  status,
  userId: USER_ID,
  assetId: ASSET_ID,
  lockerId: LOCKER_ID,
  compartmentId: COMPARTMENT_ID,
  reservationId: RESERVATION_ID,
  loanId: null,
  createdAt: '2026-11-10T14:01:00Z',
  authorizedAt: '2026-11-10T14:01:30Z',
  localAccessChallengeId: null,
  localProofExpiresAt: null,
  localProofDisplayedAt: null,
  localProofValidatedAt: null,
  requiredAction: 'NONE',
  expiresAt: null,
  commandSentAt: '2026-11-10T14:01:31Z',
  acknowledgedAt: '2026-11-10T14:01:32Z',
  doorOpenedAt: status === 'DOOR_OPENED' || status === 'CONFIRMED' ? '2026-11-10T14:02:10Z' : null,
  observationReceivedAt: null,
  confirmedAt: status === 'CONFIRMED' ? '2026-11-10T14:05:00Z' : null,
  terminalAt: TERMINAL.includes(status) ? '2026-11-10T14:05:00Z' : null,
  failureReason: null,
  anomalyId: null,
})

const ASSET = {
  id: ASSET_ID,
  assetCode: 'MM-001',
  serialNumber: null,
  model: { id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01', name: 'Multimètre 1', manufacturer: 'Fluke', modelNumber: '117' },
  requiredAccessLevel: 'STANDARD',
  operationalStatus: 'SERVICEABLE',
  calibration: { required: true, dueAt: '2026-12-01T05:00:00Z', status: 'VALID' },
  availability: 'AVAILABLE',
  presence: 'UNKNOWN',
  placement: { lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: COMPARTMENT_ID, compartmentCode: 'A1' },
  operationalDiagnostic: { evaluatedAt: '2026-11-10T14:00:00Z', reasons: ['UNKNOWN_PHYSICAL_STATE'] },
  archivedAt: null,
}

interface FakeServer {
  status: string
  /** Pathname and instant of every request the page made to the fake API. */
  readonly requests: { readonly path: string; readonly at: number }[]
  detailReads: () => number
  listReads: () => number
  /** List reads made while the page opened (the development double mount sends two): the baseline of every count. */
  listBase: number
}

async function routeOperations(page: Page): Promise<FakeServer> {
  const server: FakeServer = {
    status: 'COMMAND_ACKNOWLEDGED',
    requests: [],
    detailReads: () => server.requests.filter((request) => request.path === `/api/v1/admin/locker-operations/${OPERATION_ID}`).length,
    listReads: () => server.requests.filter((request) => request.path === '/api/v1/admin/locker-operations').length,
    listBase: 0,
  }
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })
  await page.route('**/api/v1/admin/**', (route) => {
    const url = new URL(route.request().url())
    server.requests.push({ path: url.pathname, at: Date.now() })
    if (url.pathname === '/api/v1/admin/locker-operations') return json(route, { items: [operation(server.status)], page: 0, size: 20, totalItems: 1, totalPages: 1 })
    if (url.pathname === `/api/v1/admin/locker-operations/${OPERATION_ID}`) return json(route, operation(server.status))
    if (url.pathname === `/api/v1/admin/assets/${ASSET_ID}`) return json(route, ASSET)
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://aegis.local/problems/resource_not_found', title: 'Fictif', status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'Fictif', instance: url.pathname, traceId: TRACE_ID, timestamp: '2026-11-10T14:00:00Z' }) })
  })
  return server
}

/** Chromium reports a visible tab in headless runs: the test drives `document.visibilityState` and its event. */
async function installVisibilityControl(page: Page) {
  await page.addInitScript(() => {
    let hidden = false
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    ;(window as unknown as { __setHidden: (value: boolean) => void }).__setHidden = (value) => {
      hidden = value
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    }
  })
}
const setHidden = (page: Page, value: boolean) => page.evaluate((next) => (window as unknown as { __setHidden: (value: boolean) => void }).__setHidden(next), value)

async function openDossier(page: Page): Promise<FakeServer> {
  await installVisibilityControl(page)
  const server = await routeOperations(page)
  await page.goto('/connexion')
  await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/\/apercu\/equipements$/)
  // Same document, so the in-memory session survives (as the Casiers fakes do).
  await page.evaluate((id) => {
    window.history.pushState(null, '', `/reservations-prets?vue=operations&dossier=${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, OPERATION_ID)
  await expect(dossier(page)).toHaveText('Commande acquittée')
  server.listBase = server.listReads()
  return server
}

// The status chip of the dossier: the step labels of the sequence below it also contain the words « Porte ouverte ».
const dossier = (page: Page) => page.locator('.ag-dossier__scroll .ag-diag__row')

test.describe('follow: the open operation dossier (ADR-006)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('moves from the acknowledged command to a terminal status with no click, and stops reading', async ({ page }) => {
    const server = await openDossier(page)
    const status = page.getByRole('status').filter({ hasText: /Opération mise à jour/ })

    server.status = 'DOOR_OPENED'
    await expect(dossier(page)).toHaveText('Porte ouverte', { timeout: 5_000 })
    await expect(status).toHaveText(/Opération mise à jour\s*:\s*Porte ouverte\./)

    server.status = 'CONFIRMED'
    await expect(dossier(page)).toHaveText('Confirmée', { timeout: 5_000 })
    await expect(status).toHaveText(/Opération mise à jour\s*:\s*Confirmée\./)
    // The row of the list is read once more at the transition, so it does not stay acknowledged.
    await expect.poll(() => server.listReads(), { timeout: 5_000 }).toBe(server.listBase + 1)

    await page.waitForTimeout(500)
    const reads = server.detailReads()
    await page.waitForTimeout(4_000)
    expect(server.detailReads(), 'no read of the operation once it is terminal').toBe(reads)
    expect(server.listReads(), 'the list is read once more at the transition and never polled').toBe(server.listBase + 1)
    expect(server.requests.filter((request) => request.path.includes('/reservations') || request.path.includes('/loans')).length).toBe(0)
  })

  test('keeps the request count bounded over a fixed window and never polls the list', async ({ page }) => {
    const server = await openDossier(page)
    const from = Date.now()
    const detailBefore = server.detailReads()
    const total = server.requests.length
    await page.waitForTimeout(6_000)
    const seconds = (Date.now() - from) / 1_000
    const detail = server.detailReads() - detailBefore
    // About one a second: never a burst, never idle.
    expect(detail).toBeGreaterThanOrEqual(Math.floor(seconds) - 1)
    expect(detail).toBeLessThanOrEqual(Math.ceil(seconds) + 1)
    expect(server.listReads(), 'the list is not polled').toBe(server.listBase)
    const others = server.requests.slice(total).filter((request) => !request.path.endsWith(`/locker-operations/${OPERATION_ID}`))
    expect(others, 'only the open operation is read during the window').toEqual([])
  })

  test('pauses while the tab is hidden and reads at once when it is visible again', async ({ page }) => {
    const server = await openDossier(page)
    await setHidden(page, true)
    // A read already in flight may land; then nothing.
    await page.waitForTimeout(500)
    const hiddenAt = server.detailReads()
    server.status = 'DOOR_OPENED'
    await page.waitForTimeout(4_000)
    expect(server.detailReads(), 'no read while hidden').toBe(hiddenAt)
    await expect(dossier(page)).not.toHaveText('Porte ouverte')

    await setHidden(page, false)
    await expect(dossier(page)).toHaveText('Porte ouverte', { timeout: 800 })
    expect(server.detailReads()).toBeGreaterThan(hiddenAt)
  })
})
