import { expect, test, type Page, type Route } from '@playwright/test'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * Lot 1 « Lisibilité » (contrat-web-manager §1.8, criteria 1 to 3), offline on routed fakes: the label index reads a
 * bounded number of pages whatever the number of rows, a unit is named from its own `assetId` and never from what its
 * cell holds today, and no full identifier is shown outside a closed « Détails techniques ».
 */
const LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
const A2_ID = '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10'
const MM002_ID = '22222222-0000-4000-8000-000000000002'
const MM099_ID = '99999999-0000-4000-8000-000000000099'
const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const model = { id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01', name: 'Multimètre numérique', manufacturer: 'Fluke', modelNumber: '117' }
const unit = (id: string, assetCode: string) => ({
  id,
  assetCode,
  serialNumber: null,
  model,
  requiredAccessLevel: 'STANDARD',
  operationalStatus: 'SERVICEABLE',
  calibration: { required: false, dueAt: null, status: 'NOT_REQUIRED' },
  availability: 'AVAILABLE',
  presence: 'UNKNOWN',
  placement: null,
  operationalDiagnostic: { evaluatedAt: '2026-11-10T14:00:00Z', reasons: [] },
  archivedAt: null,
})

// The contradictory fixture of criterion 3: every anomaly concerns MM-002 in cell A2, which holds MM-099 today.
const LOCKER = {
  id: LOCKER_ID,
  code: 'AEGIS-DEMO-01',
  name: 'Casier de démonstration',
  topology: 'HUB_CELL',
  compartments: [{ id: A2_ID, code: 'A2', enabled: true, currentAsset: { id: MM099_ID, assetCode: 'MM-099' } }],
}

const anomaly = (index: number) => ({
  id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, '0')}`,
  type: 'EXPECTED_ASSET_NOT_OBSERVED',
  severity: 'HIGH',
  status: 'OPEN',
  lockerOperationId: OPERATION_ID,
  assetId: MM002_ID,
  compartmentId: A2_ID,
  detectedAt: `2026-11-10T19:${String(index).padStart(2, '0')}:00Z`,
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgementNote: null,
  resolvedAt: null,
  resolutionEvidenceObservationId: null,
  resolutionNote: null,
  summary: 'Équipement attendu non lu.',
  evidence: { items: [], unreadable: 0 },
})
const anomalies = (count: number) => Array.from({ length: count }, (_, index) => anomaly(index + 1))

const pageOf = (items: unknown[], size: number, totalItems = items.length) => ({ items, page: 0, size, totalItems, totalPages: Math.max(Math.ceil(totalItems / size), 1) })

async function routeApi(page: Page, rows = 20): Promise<string[]> {
  const ANOMALIES = anomalies(rows)
  const requests: string[] = []
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })
  await page.route('**/api/v1/admin/**', (route) => {
    const url = new URL(route.request().url())
    requests.push(`${url.pathname}${url.search}`)
    const p = url.pathname.replace('/api/v1/admin', '')
    const size = Number(url.searchParams.get('size') ?? 20)
    if (p === '/anomalies') return json(route, pageOf(ANOMALIES, size))
    if (p === `/anomalies/${ANOMALIES[0]?.id}`) return json(route, ANOMALIES[0])
    if (p === '/lockers') return json(route, pageOf([LOCKER], size))
    if (p === '/assets') return json(route, pageOf([unit(MM002_ID, 'MM-002'), unit(MM099_ID, 'MM-099')], size))
    if (p === '/loans') return json(route, pageOf([], size))
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://aegis.local/problems/resource_not_found', title: 'Fictif', status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'Fictif', instance: url.pathname, traceId: TRACE_ID, timestamp: '2026-11-10T14:00:00Z' }) })
  })
  return requests
}

async function signIn(page: Page) {
  await page.goto('/connexion')
  await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/\/apercu\/equipements$/)
}

/** Same document, so the in-memory session survives. */
const go = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url)

test.describe('labels: lot 1 readability', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  /** The label reads of one visit to Anomalies with `rows` anomalies, per read of the list. */
  async function labelReads(page: Page, rows: number) {
    const requests = await routeApi(page, rows)
    await signIn(page)
    await go(page, '/anomalies')
    const shown = page.locator('main').getByRole('link').filter({ hasText: 'Équipement attendu non observé' })
    await expect(shown).toHaveCount(rows)
    await expect(shown.first()).toContainText('MM-002')
    await page.waitForLoadState('networkidle')
    const count = (test: (request: string) => boolean) => requests.filter(test).length
    return {
      shown,
      lists: count((request) => request.startsWith('/api/v1/admin/anomalies?') && request.includes('size=20')),
      unitPages: count((request) => request.startsWith('/api/v1/admin/assets?') && request.includes('size=100')),
      lockerPages: count((request) => request.startsWith('/api/v1/admin/lockers')),
      unitReads: count((request) => /\/assets\/[0-9a-f-]{36}/.test(request)),
    }
  }

  test('reads as many label pages for 20 rows as for 1: at most 5 unit pages and 1 locker page per read of the list', async ({ page, browser }) => {
    const twenty = await labelReads(page, 20)
    const otherPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const one = await labelReads(otherPage, 1)
    await otherPage.close()

    // Criterion 2: bounded and independent of the number of rows; never one request per row.
    expect({ unitPages: twenty.unitPages, lockerPages: twenty.lockerPages, unitReads: twenty.unitReads }).toEqual({ unitPages: one.unitPages, lockerPages: one.lockerPages, unitReads: 0 })
    expect(twenty.lockerPages).toBeLessThanOrEqual(twenty.lists)
    expect(twenty.unitPages).toBeLessThanOrEqual(5 * twenty.lists)

    // Criterion 3: the unit of the fact, never the current occupant of its cell.
    await expect(twenty.shown.first()).toContainText('Cellule A2')
    for (const row of await twenty.shown.all()) await expect(row).not.toContainText('MM-099')
  })

  test('shows no full identifier outside the closed « Détails techniques », and opens it with the keyboard', async ({ page }) => {
    await routeApi(page)
    await signIn(page)
    await go(page, '/anomalies')
    const dossier = page.locator('.ag-dossier__scroll')
    await expect(dossier).toContainText('MM-002')
    // Criterion 1: the rendered text (a closed <details> renders only its summary) carries no UUID.
    expect(await page.locator('main').innerText()).not.toMatch(UUID)

    const summary = dossier.getByText('Détails techniques', { exact: true })
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(dossier.locator('details.ag-tech')).toHaveAttribute('open', '')
    await expect(dossier.locator('details.ag-tech')).toContainText(MM002_ID)
    await expect(dossier.locator('details.ag-tech')).toContainText(A2_ID)
  })
})
