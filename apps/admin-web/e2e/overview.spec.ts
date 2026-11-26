import { expect, test, type Page, type Route } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalScroll, PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * Lot 2 « Vue d'ensemble » (contrat-web-manager §2.6), offline on routed fakes: each tile lands on its filtered page,
 * the acknowledgement in place sends one request for one dialog and updates the tile and the badge, a partial loan read
 * shows « N+ », and the page holds at 1440/1024/390/320 without horizontal scroll or axe violation.
 */
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
const A1_ID = '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a1a01'
const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const ANOMALY_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

const asset = {
  id: ASSET_ID,
  assetCode: 'MM-001',
  model: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Multimètre numérique', manufacturer: 'Fluke', modelNumber: '117' },
  placement: { lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1_ID, compartmentCode: 'A1' },
}
const anomaly = (status = 'OPEN') => ({
  id: ANOMALY_ID,
  type: 'EXPECTED_ASSET_NOT_OBSERVED',
  severity: 'HIGH',
  status,
  lockerOperationId: null,
  assetId: ASSET_ID,
  compartmentId: A1_ID,
  detectedAt: '2026-11-10T19:01:00Z',
  acknowledgedAt: status === 'OPEN' ? null : '2026-11-10T20:00:00Z',
  acknowledgedBy: null,
  acknowledgementNote: status === 'OPEN' ? null : 'Vu sur place',
  resolvedAt: null,
  resolutionEvidenceObservationId: null,
  resolutionNote: null,
  summary: 'Équipement attendu non lu.',
  evidence: { items: [], unreadable: 0 },
})
const loan = (index: number, overdue: boolean) => ({
  id: `11111111-0000-4000-8000-${String(index).padStart(12, '0')}`,
  asset,
  holderUserId: USER_ID,
  holder: { id: USER_ID, displayName: 'Technicien Démo' },
  status: 'ACTIVE',
  checkedOutAt: '2026-11-10T14:05:00Z',
  dueAt: '2026-11-10T17:30:00Z',
  overdue,
  returnRequestedAt: null,
  returnedAt: null,
  checkoutOperationId: '44444444-0000-4000-8000-000000000004',
  returnOperationId: null,
  currentOperationId: null,
  availableActions: [],
})
const reservation = {
  id: '33333333-0000-4000-8000-000000000003',
  asset,
  userId: USER_ID,
  user: { id: USER_ID, displayName: 'Technicien Démo' },
  status: 'ACTIVE',
  reservedFrom: '2026-11-10T14:00:00Z',
  reservedUntil: '2026-11-10T21:30:00Z',
  createdAt: '2026-11-10T14:00:00Z',
  cancelledAt: null,
  fulfilledAt: null,
  expiredAt: null,
  currentOperationId: null,
  availableActions: [],
}
const LOCKER = { id: LOCKER_ID, code: 'AEGIS-DEMO-01', name: 'Casier de démonstration', topology: 'HUB_CELL', compartments: [{ id: A1_ID, code: 'A1', enabled: true, currentAsset: { id: ASSET_ID, assetCode: 'MM-001' } }] }
const cell = { id: A1_ID, code: 'A1', enabled: true, connectionStatus: 'CONNECTED', rfidReaderStatus: 'HEALTHY', doorState: 'CLOSED', lockState: 'LOCKED', lastObservedAt: '2026-11-10T18:59:50Z' }
const STATUS = {
  lockerId: LOCKER_ID,
  code: 'AEGIS-DEMO-01',
  name: 'Casier de démonstration',
  topology: 'HUB_CELL',
  connectionStatus: 'ONLINE',
  lastSeenAt: '2026-11-10T18:59:55Z',
  evaluatedAt: '2026-11-10T19:00:00Z',
  currentWindow: { timeZone: 'America/Toronto', open: true, closesAt: '2026-11-10T22:00:00Z', nextOpensAt: null },
  compartments: [cell],
  deviceErrors: [],
}

const pageOf = (items: unknown[], size: number, totalItems = items.length) => ({ items, page: 0, size, totalItems, totalPages: Math.max(Math.ceil(totalItems / size), 1) })

interface Fake {
  readonly requests: string[]
  readonly acknowledgements: { key: string | null; body: string | null }[]
}

async function routeApi(page: Page, { activeLoans = [loan(1, true)], activeLoanTotal }: { activeLoans?: unknown[]; activeLoanTotal?: number } = {}): Promise<Fake> {
  const fake: Fake = { requests: [], acknowledgements: [] }
  let acknowledged = false
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    fake.requests.push(`${request.method()} ${url.pathname}${url.search}`)
    const p = url.pathname.replace('/api/v1', '')
    const size = Number(url.searchParams.get('size') ?? 20)
    const status = url.searchParams.get('status')
    if (p === `/admin/anomalies/${ANOMALY_ID}/acknowledge` && request.method() === 'POST') {
      fake.acknowledgements.push({ key: request.headers()['idempotency-key'] ?? null, body: request.postData() })
      // The answer is slow: a second click while the first is in flight must not send a second request.
      await new Promise((done) => setTimeout(done, 400))
      acknowledged = true
      return json(route, anomaly('ACKNOWLEDGED'))
    }
    if (p === '/admin/anomalies') return json(route, pageOf(status === 'OPEN' && acknowledged ? [] : [anomaly()], size))
    if (p === `/admin/anomalies/${ANOMALY_ID}`) return json(route, anomaly(acknowledged ? 'ACKNOWLEDGED' : 'OPEN'))
    if (p === '/admin/loans') return json(route, status === 'ACTIVE' ? pageOf(activeLoans, size, activeLoanTotal ?? activeLoans.length) : pageOf([], size))
    if (p === '/admin/reservations') return json(route, pageOf(status === 'ACTIVE' ? [reservation] : [], size))
    if (p === '/admin/locker-operations') return json(route, pageOf([], size))
    if (p === '/admin/lockers') return json(route, pageOf([LOCKER], size))
    if (p === '/admin/assets') return json(route, pageOf([], size))
    if (p === `/lockers/${LOCKER_ID}/status`) return json(route, STATUS)
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://aegis.local/problems/resource_not_found', title: 'Fictif', status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'Fictif', instance: url.pathname, traceId: TRACE_ID, timestamp: '2026-11-10T14:00:00Z' }) })
  })
  return fake
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

const band = (page: Page) => page.getByRole('list', { name: 'Synthèse' })
const tiles = (page: Page) => band(page).getByRole('link')

async function openOverview(page: Page) {
  await signIn(page)
  await go(page, '/vue-d-ensemble')
  await expect(tiles(page)).toHaveCount(5)
  await expect(band(page).locator('.ag-skel__bar')).toHaveCount(0)
}

test.describe('overview: lot 2 summary band', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const TILES: readonly [string, RegExp, RegExp][] = [
    ['Anomalies ouvertes', /\/anomalies$/, /Anomalies/],
    ['Prêts en retard', /\/reservations-prets\?vue=prets&statut=ACTIVE$/, /Réservations et prêts/],
    ['Casier', /\/casiers$/, /Casiers/],
    ['Opération en cours', /\/reservations-prets\?vue=operations$/, /Réservations et prêts/],
    ['Réservations actives', /\/reservations-prets\?statut=ACTIVE$/, /Réservations et prêts/],
  ]
  for (const [index, [name, address, heading]] of TILES.entries()) {
    test(`the « ${name} » tile lands on its filtered page, and Back returns to the overview`, async ({ page }) => {
      await routeApi(page)
      await openOverview(page)
      const tile = tiles(page).nth(index)
      await expect(tile).toContainText(name)
      await tile.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(address)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
      await page.goBack()
      await expect(page).toHaveURL(/\/vue-d-ensemble$/)
      await expect(tiles(page)).toHaveCount(5)
    })
  }

  test('acknowledges in place: one request for two clicks, the reminder kept, the tile and the badge updated', async ({ page }) => {
    const fake = await routeApi(page)
    await openOverview(page)
    await expect(tiles(page).first()).toContainText('1')
    const nav = page.getByRole('navigation', { name: 'Sections' }).first()
    await expect(nav.getByRole('link', { name: /^Anomalies/ })).toContainText('1')

    await page.getByRole('region', { name: 'Anomalies ouvertes' }).getByRole('button', { name: /^Reconnaître/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Reconnaître cette anomalie' })
    await expect(dialog).toContainText('cela ne résout pas l’anomalie')
    await dialog.getByLabel('Note de reconnaissance').fill('Vu sur place')
    const submit = dialog.getByRole('button', { name: 'Reconnaître l’anomalie' })
    await submit.click()
    await submit.click({ force: true })

    await expect(page.getByText("Anomalie reconnue; elle reste ouverte jusqu'à une nouvelle observation.")).toBeAttached()
    expect(fake.acknowledgements).toHaveLength(1)
    expect(fake.acknowledgements[0]?.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(fake.acknowledgements[0]?.body ?? '{}')).toEqual({ note: 'Vu sur place' })
    await expect(tiles(page).first()).toContainText('Aucune')
    await expect(nav.getByRole('link', { name: /^Anomalies/ })).not.toContainText('1')
    await expect(page.getByRole('heading', { level: 2, name: 'Anomalies ouvertes' })).toBeFocused()
    // No reload: the document that signed in is still the one shown.
    expect(fake.requests.filter((request) => request.startsWith('GET /api/v1/admin/anomalies?')).length).toBeGreaterThan(1)
  })

  test('shows « N+ » and an accessible « Lecture incomplète » when the loans exceed one page', async ({ page }) => {
    await routeApi(page, { activeLoans: Array.from({ length: 100 }, (_, index) => loan(index + 1, index === 0)), activeLoanTotal: 150 })
    await openOverview(page)
    const tile = tiles(page).nth(1)
    await expect(tile).toContainText('1+')
    await expect(tile).toHaveAccessibleName(/Prêts en retard\s*1\+\s*Lecture incomplète/)
    await expect(page.getByText('Aucune intervention en attente', { exact: false })).toHaveCount(0)
  })

  test('tabs from the title through Aide and Actualiser to the tiles, then the modules', async ({ page }) => {
    await routeApi(page)
    await openOverview(page)
    await page.getByRole('heading', { level: 1 }).focus()
    const order: string[] = []
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab')
      order.push(
        await page.evaluate(() => {
          const active = document.activeElement
          if (active?.closest('.ag-band')) return 'tile'
          // The page body is a keyboard-scrollable region when it overflows: one stop, before what it holds.
          if (active?.classList.contains('ag-ov__scroll')) return 'scroll'
          return (active?.textContent ?? '').trim().slice(0, 20)
        }),
      )
    }
    expect(order.filter((stop) => stop !== 'scroll').slice(0, 7)).toEqual(['Aide', 'Actualiser', 'tile', 'tile', 'tile', 'tile', 'tile'])
    expect(order.indexOf('tile')).toBeLessThanOrEqual(3)
  })

  for (const width of [1440, 1024, 390, 320]) {
    test(`holds at ${width} px without horizontal scroll or axe violation`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await routeApi(page)
      await openOverview(page)
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page)
    })
  }
})

test.describe('overview: compact below 560 px (contract §8.1)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  const pageHeight = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight)

  test('previews 3 rows per module, reads the band once, and stays within 2300 px, 2700 px when stale', async ({ page }) => {
    await routeApi(page, { activeLoans: [1, 2, 3, 4, 5, 6].map((index) => loan(index, true)) })
    await openOverview(page)
    const loans = page.getByRole('region', { name: 'Prêts en retard' })
    await expect(loans.locator('.ag-ov__row')).toHaveCount(3)
    await expect(loans).toContainText('Affichage de 3 sur 6.')
    // One read line for the band; no read time inside the tiles.
    await expect(page.locator('.ag-band__read')).toBeVisible()
    await expect(page.locator('.ag-tile__read').first()).toBeHidden()
    expect(await pageHeight(page)).toBeLessThanOrEqual(2300)

    // A refresh that fails everywhere: one stale notice under the band, a chip in each module heading.
    await page.unroute('**/api/v1/**')
    await page.route('**/api/v1/**', (route) => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://aegis.local/problems/service_unavailable', title: 'Fictif', status: 503, code: 'SERVICE_UNAVAILABLE', detail: 'Fictif', instance: '/', traceId: TRACE_ID, timestamp: '2026-11-10T14:00:00Z' }) }))
    await page.getByRole('button', { name: 'Actualiser' }).click()
    await expect(page.locator('.ag-band__read')).toContainText('Non actualisé')
    await expect(page.locator('.ag-ov__stalechip').first()).toBeVisible()
    await expect(page.locator('.ag-ov__stale:visible')).toHaveCount(0)
    expect(await pageHeight(page)).toBeLessThanOrEqual(2700)
    await expectNoHorizontalScroll(page)
  })

  test('keeps the locker code whole and names the closing time alone', async ({ page }) => {
    await routeApi(page)
    await openOverview(page)
    const code = page.locator('.ag-tile__code')
    await expect(code).toHaveText('AEGIS-DEMO-01')
    const box = await code.boundingBox()
    // One line: the code never breaks inside.
    expect(box?.height ?? 99).toBeLessThan(24)
  })
})

