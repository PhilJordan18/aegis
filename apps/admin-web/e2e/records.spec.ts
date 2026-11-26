import { expect, test, type Page, type Route } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalScroll, PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * Lot 3 « Dossiers et listes » (contrat-web-manager §3.8), offline on routed fakes: the tables and their counter, the
 * filters that apply without a button, a non-UUID audit filter that sends nothing, the selection focus per width, the
 * dossier action zone, and the pages at 1440/1280/1024/390/320 without horizontal scroll or axe violation.
 */
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
const A1_ID = '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a1a01'
const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const OPERATION_ID = '44444444-0000-4000-8000-000000000004'

const asset = {
  id: ASSET_ID,
  assetCode: 'MM-001',
  model: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Multimètre numérique', manufacturer: 'Fluke', modelNumber: '117' },
  placement: { lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1_ID, compartmentCode: 'A1' },
}
const reservation = (index: number) => ({
  id: `33333333-0000-4000-8000-${String(index).padStart(12, '0')}`,
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
})
/** An operation whose long status label (« Commande transmise ») once spilled out of its cell (QA #246 item 7). */
const OPERATION = {
  id: OPERATION_ID,
  type: 'CHECKOUT',
  status: 'COMMAND_SENT',
  userId: USER_ID,
  user: { id: USER_ID, displayName: 'Technicien Démo' },
  assetId: ASSET_ID,
  asset,
  lockerId: LOCKER_ID,
  compartmentId: A1_ID,
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
  acknowledgedAt: null,
  doorOpenedAt: null,
  observationReceivedAt: null,
  confirmedAt: null,
  terminalAt: null,
  failureReason: null,
  anomalyId: null,
}
const EVENT = {
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  eventType: 'COMMAND_ACKNOWLEDGED',
  actor: null,
  subjectType: 'LOCKER_OPERATION',
  subjectId: OPERATION_ID,
  operationId: OPERATION_ID,
  fromState: 'COMMAND_SENT',
  toState: 'COMMAND_ACKNOWLEDGED',
  result: 'ACCEPTED',
  reason: null,
  occurredAt: '2026-11-10T14:01:32Z',
  details: {},
}
const LOCKER = { id: LOCKER_ID, code: 'AEGIS-DEMO-01', name: 'Casier de démonstration', topology: 'HUB_CELL', compartments: [{ id: A1_ID, code: 'A1', enabled: true, currentAsset: { id: ASSET_ID, assetCode: 'MM-001' } }] }
const STATUS = {
  lockerId: LOCKER_ID,
  code: 'AEGIS-DEMO-01',
  name: 'Casier de démonstration',
  topology: 'HUB_CELL',
  connectionStatus: 'ONLINE',
  lastSeenAt: '2026-11-10T18:59:55Z',
  evaluatedAt: '2026-11-10T19:00:00Z',
  currentWindow: { timeZone: 'America/Toronto', open: true, closesAt: '2026-11-10T22:00:00Z', nextOpensAt: null },
  compartments: [{ id: A1_ID, code: 'A1', enabled: true, connectionStatus: 'CONNECTED', rfidReaderStatus: 'HEALTHY', doorState: 'CLOSED', lockState: 'LOCKED', lastObservedAt: '2026-11-10T18:59:50Z' }],
  deviceErrors: [],
}

/** The Casiers page finds its lockers through the placed units. */
const UNIT = {
  id: ASSET_ID,
  assetCode: 'MM-001',
  serialNumber: null,
  model: asset.model,
  requiredAccessLevel: 'STANDARD',
  operationalStatus: 'SERVICEABLE',
  calibration: { required: false, dueAt: null, status: 'NOT_REQUIRED' },
  availability: 'AVAILABLE',
  presence: 'PRESENT',
  placement: asset.placement,
  operationalDiagnostic: { evaluatedAt: '2026-11-10T14:00:00Z', reasons: [] },
  archivedAt: null,
}

const pageOf = (items: unknown[], size: number, totalItems = items.length) => ({ items, page: 0, size, totalItems, totalPages: Math.max(Math.ceil(totalItems / size), 1) })

async function routeApi(page: Page): Promise<string[]> {
  const requests: string[] = []
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`)
    const p = url.pathname.replace('/api/v1', '')
    const size = Number(url.searchParams.get('size') ?? 20)
    // Two rows of a collection of 143 (§3.8 criterion 3); an active filter narrows it to the two.
    if (p === '/admin/reservations') return json(route, pageOf([reservation(1), reservation(2)], size, url.searchParams.get('status') === null ? 143 : 2))
    if (p.startsWith('/admin/reservations/')) return json(route, reservation(Number(p.slice(-1))))
    if (p === '/admin/locker-operations') return json(route, pageOf([OPERATION], size))
    if (p.startsWith('/admin/locker-operations/')) return json(route, OPERATION)
    if (p === '/admin/loans' || p === '/admin/anomalies') return json(route, pageOf([], size))
    if (p === '/admin/audit-events') return json(route, { items: [EVENT], nextCursor: null, hasMore: false })
    if (p === '/admin/lockers') return json(route, pageOf([LOCKER], size))
    if (p === '/admin/assets') return json(route, pageOf([UNIT], size))
    if (p === `/lockers/${LOCKER_ID}/status`) return json(route, STATUS)
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

const table = (page: Page) => page.locator('table.ag-tbl')
/** One link per record: in the table from 1280 px, the card row itself below. */
const rowLinks = (page: Page) => page.locator('.ag-list .ag-list__items a')

async function openReservations(page: Page, url = '/reservations-prets') {
  const requests = await routeApi(page)
  await signIn(page)
  await go(page, url)
  await expect(rowLinks(page)).toHaveCount(2)
  return requests
}

test.describe('records: lot 3 tables, filters and dossiers', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the reservations are a table with column headers, a hidden caption and a page-versus-collection counter', async ({ page }) => {
    await openReservations(page)
    await expect(page.getByRole('heading', { level: 2, name: /2 sur 143 réservations/ })).toBeVisible()
    const headers = table(page).locator('thead th')
    expect(await headers.count()).toBeGreaterThan(2)
    for (const scope of await headers.evaluateAll((cells) => cells.map((cell) => cell.getAttribute('scope')))) expect(scope).toBe('col')
    const caption = table(page).locator('caption')
    await expect(caption).toHaveClass(/ag-sr-only/)
    await expect(table(page).locator('[aria-sort], thead button')).toHaveCount(0)
  })

  test('a filter applies without a button, returns to page 1, shows its chip; Back undoes it and clearing goes to the bare address', async ({ page }) => {
    const requests = await openReservations(page, '/reservations-prets?page=2')
    await expect(page.getByRole('button', { name: 'Filtrer' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Tout afficher' })).toHaveCount(0)
    const before = requests.length
    await page.getByLabel('Statut').selectOption('ACTIVE')
    await expect(page).toHaveURL(/\/reservations-prets\?statut=ACTIVE$/)
    await expect.poll(() => requests.slice(before).some((request) => request.includes('/admin/reservations?') && request.includes('status=ACTIVE') && request.includes('page=0'))).toBe(true)
    const chips = page.getByRole('group', { name: 'Filtres actifs' })
    await expect(chips).toContainText('Statut')
    await expect(chips.getByRole('button', { name: 'Retirer le filtre Statut' })).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/reservations-prets\?page=2$/)
    await page.goForward()
    await expect(page).toHaveURL(/statut=ACTIVE$/)
    await chips.getByRole('button', { name: 'Effacer les filtres' }).click()
    await expect(page).toHaveURL(/\/reservations-prets$/)
  })

  test('a date typed digit by digit applies once, with its whole year, never a partial one', async ({ page }) => {
    const requests = await openReservations(page)
    const before = requests.length
    const length = await page.evaluate(() => window.history.length)
    const field = page.getByLabel('Du (inclus)')
    await field.focus()
    // The headless browser orders the segments mm/dd/yyyy: the year comes last and reads 0002, 0020, 0202, then 2026.
    for (const key of '11102026') await page.keyboard.press(key, { delay: 30 })
    await expect(page).toHaveURL(/du=2026-11-10/)
    await page.waitForTimeout(300)
    const reads = requests.slice(before).filter((request) => request.includes('/admin/reservations?'))
    expect(reads.every((request) => request.includes('from=2026-11-10'))).toBe(true)
    expect(reads).toHaveLength(1)
    expect(await page.evaluate(() => window.history.length)).toBe(length + 1)
  })

  test('the status list applies at once with the pointer, but only after a pause from the keyboard', async ({ page }) => {
    const requests = await openReservations(page)
    const length = await page.evaluate(() => window.history.length)
    const status = page.getByLabel('Statut')
    await status.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(/\/reservations-prets$/)
    await expect(page).toHaveURL(/statut=/, { timeout: 2000 })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.history.length)).toBe(length + 1)
    expect(requests.filter((request) => request.includes('/admin/reservations?') && request.includes('status=')).length).toBe(1)
  })

  test('the active filters sit on their own line under the filter bar, « Effacer les filtres » last', async ({ page }) => {
    await openReservations(page, '/reservations-prets?statut=ACTIVE')
    const bar = await page.locator('.ag-filters__grid').boundingBox()
    const chips = page.getByRole('group', { name: 'Filtres actifs' })
    const group = await chips.boundingBox()
    expect(group!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height)
    expect(group!.x).toBeCloseTo(bar!.x, 0)
    await expect(chips.locator('button').last()).toHaveText('Effacer les filtres')
  })

  test('at 1440 px the focus stays on the selected row and the selection is announced', async ({ page }) => {
    await openReservations(page)
    await rowLinks(page).nth(1).click()
    await expect(rowLinks(page).nth(1)).toBeFocused()
    await expect(rowLinks(page).nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('status').filter({ hasText: /sélectionné/i }).first()).toBeAttached()
  })

  test('an audit identifier that is not a UUID sends no request and says what is expected', async ({ page }) => {
    const requests = await routeApi(page)
    await signIn(page)
    await go(page, '/audit')
    await expect(rowLinks(page)).toHaveCount(1)
    await page.locator('summary', { hasText: 'Filtres' }).click()
    const before = requests.length
    await page.getByLabel("Identifiant d'opération").fill('not-a-uuid')
    await expect(page.getByText('Identifiant attendu au format UUID.')).toBeVisible()
    await page.waitForTimeout(600)
    expect(requests.slice(before).filter((request) => request.includes('/admin/audit-events'))).toEqual([])
  })

  test('the locker dossier opens with its two actions, then its state block', async ({ page }) => {
    await routeApi(page)
    await signIn(page)
    await go(page, '/casiers')
    const actions = page.getByRole('group', { name: 'Actions sur le casier' })
    await expect(actions.locator('a, button')).toHaveText(['Modifier l’horaire', 'Voir les opérations de ce casier'])
    await expect(page.locator('.ag-callout')).toContainText("Cette lecture n'autorise aucune ouverture.")
    await expect(page.getByRole('heading', { level: 3, name: /^0 erreur signalée/ })).toBeVisible()
  })
})

/** Each header sits over its column, and no column is narrower than Design §8.2 allows. */
async function expectAlignedColumns(page: Page) {
  const geometry = await table(page).evaluate((element) => {
    const box = (cell: Element) => cell.getBoundingClientRect()
    const heads = [...element.querySelectorAll('thead th')].map((cell) => ({ key: cell.className, left: box(cell).left, width: box(cell).width, content: box(cell).width - parseFloat(getComputedStyle(cell).paddingLeft) - parseFloat(getComputedStyle(cell).paddingRight) }))
    const row = element.querySelector('tbody tr.ag-tbl__row')
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((cell) => ({ left: box(cell).left, width: box(cell).width }))
    const wrap = element.parentElement as HTMLElement
    // A chip never spills out of its cell (QA #246 item 7).
    const spill = [...element.querySelectorAll('td .ag-chip')].map((chip) => box(chip).right - box(chip.closest('td') as Element).right)
    return { heads, cells, overflow: wrap.scrollWidth - wrap.clientWidth, spill: Math.max(0, ...spill) }
  })
  expect(geometry.cells).toHaveLength(geometry.heads.length)
  geometry.heads.forEach((head, index) => {
    expect(Math.abs(head.left - geometry.cells[index]!.left)).toBeLessThan(1)
    expect(Math.abs(head.width - geometry.cells[index]!.width)).toBeLessThan(1)
    // Design §8.2: no column under 96 px, Statut with 120 px for its chips.
    if (head.key.includes('status')) expect(head.content).toBeGreaterThanOrEqual(120)
    else expect(head.width).toBeGreaterThanOrEqual(96)
  })
  expect(geometry.overflow).toBeLessThanOrEqual(0)
  expect(geometry.spill).toBeLessThanOrEqual(0)
}

for (const [width, headers] of [
  [1440, ['Statut', 'Équipement', 'Titulaire', 'Période']],
  [1280, ['Statut', 'Équipement', 'Période']],
] as const) {
  test.describe(`records: the table at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test(`headers line up with their cells and keep their minimum width at ${width} px`, async ({ page }) => {
      await openReservations(page, `/reservations-prets?dossier=${reservation(1).id}`)
      await expect(table(page).locator('thead th')).toHaveText([...headers])
      await expectAlignedColumns(page)
      await go(page, '/audit')
      await expect(rowLinks(page)).toHaveCount(1)
      await expectAlignedColumns(page)
      const panels = await page.locator('.ag-eq > .ag-panel').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width))
      expect(panels.at(-1)).toBeCloseTo(480, 0)
    })
  })
}

test.describe('records: card rows beside the dossier from 1024 to 1279 px', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('the list is card rows on the left, the dossier on the right, and no table', async ({ page }) => {
    await openReservations(page, `/reservations-prets?dossier=${reservation(1).id}`)
    await expect(page.locator('table')).toHaveCount(0)
    await expect(rowLinks(page).first()).toHaveClass(/ag-item/)
    const [list, dossier] = await page.locator('.ag-eq > .ag-panel').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect))
    expect(list!.width).toBeGreaterThanOrEqual(320)
    expect(list!.width).toBeLessThanOrEqual(380)
    expect(dossier!.left).toBeGreaterThan(list!.right)
    expect(dossier!.top).toBeCloseTo(list!.top, 0)
    await rowLinks(page).nth(1).click()
    await expect(rowLinks(page).nth(1)).toBeFocused()
    await go(page, '/audit')
    await expect(page.locator('table')).toHaveCount(0)
    await expect(rowLinks(page)).toHaveCount(1)
  })
})

test.describe('records: below 1024 px the selection moves to the dossier', () => {
  test.use({ viewport: { width: 1000, height: 800 } })

  test('selecting a row scrolls to the dossier and focuses it', async ({ page }) => {
    await openReservations(page)
    await rowLinks(page).nth(1).click()
    await expect(page.locator('.ag-dossier__scroll')).toBeFocused()
  })
})

for (const width of [1440, 1280, 1024, 390, 320]) {
  test.describe(`records at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test(`reservations, audit and lockers hold at ${width} px without horizontal scroll or axe violation`, async ({ page }) => {
      await openReservations(page)
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page)
      await go(page, '/reservations-prets?vue=operations')
      await expect(rowLinks(page)).toHaveCount(1)
      await expectNoHorizontalScroll(page)
      const spill = await page.locator('.ag-list .ag-chip').evaluateAll((chips) => Math.max(0, ...chips.map((chip) => chip.getBoundingClientRect().right - (chip.closest('td, a') as Element).getBoundingClientRect().right)))
      expect(spill).toBeLessThanOrEqual(0)
      await go(page, '/audit')
      await expect(rowLinks(page)).toHaveCount(1)
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page)
      await go(page, '/casiers')
      await expect(page.getByRole('group', { name: 'Actions sur le casier' })).toBeVisible()
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page)
    })
  })
}
