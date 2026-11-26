import { expect, test, type Page, type Route } from '@playwright/test'
import { expectNoHorizontalScroll, PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

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
/** An operation that names its anomaly and a locker outside the label index (§1.8 criterion 1 on every page). */
const UNKNOWN_LOCKER_ID = '77777777-0000-4000-8000-000000000077'
const LINKED_OPERATION = {
  id: OPERATION_ID,
  type: 'CHECKOUT',
  status: 'ANOMALY',
  userId: '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8',
  user: { id: '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8', displayName: 'Technicien Démo' },
  assetId: MM002_ID,
  asset: { id: MM002_ID, assetCode: 'MM-002', model, placement: null },
  lockerId: LOCKER_ID,
  compartmentId: A2_ID,
  reservationId: null,
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
  doorOpenedAt: null,
  observationReceivedAt: null,
  confirmedAt: null,
  terminalAt: '2026-11-10T14:05:00Z',
  failureReason: null,
  anomalyId: 'aaaaaaaa-0000-4000-8000-000000000001',
}

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
    if (p === '/loans' || p === '/reservations') return json(route, pageOf([], size))
    if (p === '/locker-operations') return json(route, pageOf([LINKED_OPERATION], size))
    if (p === `/locker-operations/${OPERATION_ID}`) return json(route, LINKED_OPERATION)
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

/**
 * What the eye reads in the main region: the rendered text without the screen-reader-only copies, which carry the full
 * identifier for assistive technologies (§1.2). A closed <details> renders only its summary.
 */
const seenText = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement
    const hidden = [...main.querySelectorAll<HTMLElement>('.ag-sr-only')]
    for (const node of hidden) node.style.display = 'none'
    const text = main.innerText
    for (const node of hidden) node.style.display = ''
    return text
  })

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

  test('shows no full identifier in an operation dossier with its linked anomaly, nor in the locker filter', async ({ page }) => {
    await routeApi(page)
    await signIn(page)
    await go(page, `/reservations-prets?vue=operations&casier=${UNKNOWN_LOCKER_ID}`)
    const dossier = page.locator('.ag-dossier__scroll')
    await expect(dossier.getByRole('link', { name: "Ouvrir l'anomalie" })).toBeVisible()
    await expect(page.getByTestId('locker-filter')).toContainText('77777777…')
    await expect(dossier).toContainText('aaaaaaaa…')
    expect(await seenText(page)).not.toMatch(UUID)
  })
})

test.describe('labels: the « Identifiant seulement » fallback on a narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a unit outside the index holds in the full-width picker without horizontal scroll', async ({ page }) => {
    await routeApi(page)
    await signIn(page)
    await go(page, `/reservations-prets?equipement=${UNKNOWN_LOCKER_ID}`)
    const chosen = page.locator('.ag-picker__chosen')
    await expect(chosen).toContainText('Identifiant seulement')
    await expectNoHorizontalScroll(page)
    // §1.8 responsive: below 560 px the picker takes the whole row of the filter grid.
    const grid = await page.locator('.ag-filters__grid').boundingBox()
    const picker = await page.locator('.ag-filters__grid > .ag-picker').boundingBox()
    expect(Math.round(picker?.width ?? 0)).toBe(Math.round(grid?.width ?? -1))
  })
})
