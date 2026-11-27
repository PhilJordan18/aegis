import { expect, test, type Page, type Route } from '@playwright/test'
import { DEMO_LOCKER_ID, routeLockers } from './lockerFakes.ts'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * Links between the custody dossiers (gaps R2, R3 and R4), offline on routed fakes: the browser never reaches an API.
 * Each test follows a link with a click and checks both the address it lands on and the request the destination sends.
 * The run against the real API is a separate acceptance, not part of this file.
 */
const OPERATION_ID = '2f38d3b6-c18f-4a74-aa9a-2d574286013f'
const ATTEMPT_ID = 'aaaaaaaa-0000-4000-8000-00000000a001'
const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const COMPARTMENT_ID = '4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b'
const RESERVATION_ID = '7b726e56-2a19-44de-887b-d3e2bfc8bf28'
const ACTIVE_ID = 'bbbbbbbb-0000-4000-8000-00000000b001'
const ANOMALY_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const EVENT_ID = '5d6e7f80-91a2-4b3c-8d4e-5f60718293a4'
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const LOCKER_ID = DEMO_LOCKER_ID

const operation = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'CHECKOUT',
  status: 'ANOMALY',
  userId: USER_ID,
  // R7: an operation carries its user and equipment summaries; the parser refuses one without them.
  user: { id: USER_ID, displayName: 'Technicien Démo' },
  assetId: ASSET_ID,
  asset: { id: ASSET_ID, assetCode: 'MM-001', model: { id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01', name: 'Multimètre 1', manufacturer: 'Fluke', modelNumber: '117' }, placement: { lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: COMPARTMENT_ID, compartmentCode: 'A1' } },
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
  doorOpenedAt: null,
  observationReceivedAt: null,
  confirmedAt: null,
  terminalAt: '2026-11-10T14:05:00Z',
  failureReason: null,
  anomalyId: ANOMALY_ID,
  ...overrides,
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
const SUMMARY = { id: ASSET_ID, assetCode: 'MM-001', model: ASSET.model, placement: ASSET.placement }
const RESERVATION = {
  id: RESERVATION_ID,
  asset: SUMMARY,
  userId: USER_ID,
  user: { id: USER_ID, displayName: 'Technicien Démo' },
  status: 'FULFILLED',
  reservedFrom: '2026-11-10T14:00:00Z',
  reservedUntil: '2026-11-10T20:30:00Z',
  createdAt: '2026-11-10T14:00:00Z',
  cancelledAt: null,
  fulfilledAt: '2026-11-10T14:06:00Z',
  expiredAt: null,
  currentOperationId: null,
  availableActions: [],
}
const ACTIVE = { ...RESERVATION, id: ACTIVE_ID, currentOperationId: ATTEMPT_ID, status: 'ACTIVE', fulfilledAt: null }
const ANOMALY = {
  id: ANOMALY_ID,
  type: 'EXPECTED_ASSET_NOT_OBSERVED',
  severity: 'HIGH',
  status: 'ACKNOWLEDGED',
  lockerOperationId: OPERATION_ID,
  assetId: ASSET_ID,
  compartmentId: COMPARTMENT_ID,
  detectedAt: '2026-11-10T19:02:00Z',
  acknowledgedAt: '2026-11-10T19:10:00Z',
  acknowledgedBy: { id: USER_ID, displayName: 'Administrateur de démonstration' },
  acknowledgementNote: 'Inspection planifiée.',
  resolvedAt: null,
  resolutionEvidenceObservationId: null,
  resolutionNote: null,
  summary: 'Équipement attendu non lu.',
  evidence: { items: [], unreadable: 0 },
}
const EVENT = {
  id: EVENT_ID,
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

const page1 = (items: unknown[]) => ({ items, page: 0, size: 20, totalItems: items.length, totalPages: items.length === 0 ? 0 : 1 })

interface Fake {
  /** Path and query of every request the page made to the fake API. */
  readonly requests: string[]
  readonly reads: (needle: string) => number
}

async function routeApi(page: Page): Promise<Fake> {
  const requests: string[] = []
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })
  await page.route('**/api/v1/admin/**', (route) => {
    const url = new URL(route.request().url())
    requests.push(`${url.pathname}${url.search}`)
    const p = url.pathname.replace('/api/v1/admin', '')
    if (p === '/locker-operations') return json(route, page1([operation(OPERATION_ID)]))
    if (p === `/locker-operations/${OPERATION_ID}`) return json(route, operation(OPERATION_ID))
    if (p === `/locker-operations/${ATTEMPT_ID}`) return json(route, operation(ATTEMPT_ID, { status: 'COMMAND_ACKNOWLEDGED', terminalAt: null, anomalyId: null }))
    if (p === '/reservations') return json(route, page1([url.searchParams.get('assetId') === null ? ACTIVE : RESERVATION]))
    if (p === '/loans') return json(route, page1([]))
    if (p === `/reservations/${ACTIVE_ID}`) return json(route, ACTIVE)
    if (p === `/reservations/${RESERVATION_ID}`) return json(route, RESERVATION)
    if (p === '/anomalies') return json(route, page1([ANOMALY]))
    if (p === `/anomalies/${ANOMALY_ID}`) return json(route, ANOMALY)
    if (p === '/audit-events') return json(route, { items: [EVENT], nextCursor: null, hasMore: false })
    if (p === '/assets') return json(route, page1([ASSET]))
    if (p === `/assets/${ASSET_ID}`) return json(route, ASSET)
    if (p === `/assets/${ASSET_ID}/identifiers`) return json(route, [])
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://aegis.local/problems/resource_not_found', title: 'Fictif', status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'Fictif', instance: url.pathname, traceId: TRACE_ID, timestamp: '2026-11-10T14:00:00Z' }) })
  })
  return { requests, reads: (needle) => requests.filter((request) => request.includes(needle)).length }
}

async function signIn(page: Page) {
  await page.goto('/connexion')
  await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/\/apercu\/equipements$/)
}

/** Same document, so the in-memory session survives (as the other fakes do). */
const go = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url)

const here = (page: Page) => page.evaluate(() => `${window.location.pathname}${window.location.search}`)
const dossier = (page: Page) => page.locator('.ag-dossier__scroll')

test.describe('links: custody dossiers (R2, R3, R4)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('walks operation → anomaly → operation → audit → operation without typing an identifier', async ({ page }) => {
    const fake = await routeApi(page)
    await signIn(page)
    await go(page, `/reservations-prets?vue=operations&dossier=${OPERATION_ID}`)

    await dossier(page).getByRole('link', { name: "Ouvrir l'anomalie" }).click()
    await expect.poll(() => here(page)).toBe(`/anomalies?anomalie=${ANOMALY_ID}`)
    await expect(dossier(page)).toContainText('Équipement attendu non observé')

    await dossier(page).getByRole('link', { name: "Ouvrir l'opération" }).click()
    await expect.poll(() => here(page)).toBe(`/reservations-prets?vue=operations&dossier=${OPERATION_ID}`)
    // The anomaly's status is read from the anomaly itself, apart from the operation's own words.
    await expect(dossier(page)).toContainText('Reconnue : la vérification est engagée')

    await dossier(page).getByRole('link', { name: 'Audit de cette opération' }).click()
    await expect.poll(() => here(page)).toBe(`/audit?operation=${OPERATION_ID}`)
    await expect.poll(() => fake.reads(`/audit-events?`)).toBeGreaterThan(0)
    expect(fake.requests.find((request) => request.startsWith('/api/v1/admin/audit-events'))).toContain(`operationId=${OPERATION_ID}`)

    await page.getByRole('link', { name: "Ouvrir le dossier de l'opération" }).click()
    await expect.poll(() => here(page)).toBe(`/reservations-prets?vue=operations&dossier=${OPERATION_ID}`)
  })

  test('opens the operation and its audit from an anomaly dossier', async ({ page }) => {
    await routeApi(page)
    await signIn(page)
    await go(page, `/anomalies?anomalie=${ANOMALY_ID}`)
    await dossier(page).getByRole('link', { name: 'Audit de cette opération' }).click()
    await expect.poll(() => here(page)).toBe(`/audit?operation=${OPERATION_ID}`)
  })

  test('goes from a fulfilled reservation to the loans of its equipment', async ({ page }) => {
    const fake = await routeApi(page)
    await signIn(page)
    await go(page, `/reservations-prets?equipement=${ASSET_ID}`)
    await dossier(page).getByRole('link', { name: 'Voir les prêts de cet équipement' }).click()
    await expect.poll(() => here(page)).toBe(`/reservations-prets?vue=prets&equipement=${ASSET_ID}`)
    await expect.poll(() => fake.requests.some((request) => request.startsWith('/api/v1/admin/loans') && request.includes(`assetId=${ASSET_ID}`))).toBe(true)
  })

  test('goes from Casiers to the operations of the locker, and the list asks for that locker only', async ({ page }) => {
    await routeLockers(page, 'nominal')
    const asked: string[] = []
    await page.route('**/api/v1/admin/locker-operations**', (route) => {
      asked.push(new URL(route.request().url()).search)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page1([operation(OPERATION_ID)])) })
    })
    await signIn(page)
    await go(page, '/casiers')
    await page.getByRole('link', { name: 'Voir les opérations de ce casier' }).click()
    await expect.poll(() => here(page)).toBe(`/reservations-prets?vue=operations&casier=${LOCKER_ID}`)
    await expect(page.getByTestId('locker-filter')).toContainText(LOCKER_ID)
    await expect.poll(() => asked.some((search) => search.includes(`lockerId=${LOCKER_ID}`))).toBe(true)
    await page.getByRole('link', { name: 'Retirer ce filtre' }).click()
    await expect.poll(() => here(page)).toBe('/reservations-prets?vue=operations')
    await expect(page.getByTestId('locker-filter')).toHaveCount(0)
  })

  test('goes from an equipment to its loans, reservations, operations and audit', async ({ page }) => {
    const fake = await routeApi(page)
    await signIn(page)
    await go(page, `/equipements?exemplaire=${ASSET_ID}`)
    const history = page.getByRole('region', { name: 'Historique de cet équipement' })
    await expect(history.getByRole('link')).toHaveCount(4)
    await history.getByRole('link', { name: 'Voir l’audit de cet équipement' }).click()
    await expect.poll(() => here(page)).toBe(`/audit?sujetType=ASSET&sujet=${ASSET_ID}`)
    await expect.poll(() => fake.requests.some((request) => request.startsWith('/api/v1/admin/audit-events') && request.includes('subjectType=ASSET') && request.includes(`subjectId=${ASSET_ID}`))).toBe(true)
  })

  test('shows the attempt of an active reservation inline, read once and not followed', async ({ page }) => {
    const fake = await routeApi(page)
    await signIn(page)
    await go(page, '/reservations-prets')
    await expect(dossier(page)).toContainText('Commande acquittée')
    await expect(dossier(page)).toContainText("Ce n'est pas une confirmation physique.")
    await expect(dossier(page)).toContainText('son expiration est différée')
    const reads = fake.reads(`/locker-operations/${ATTEMPT_ID}`)
    await page.waitForTimeout(3_000)
    expect(fake.reads(`/locker-operations/${ATTEMPT_ID}`), 'no polling from a reservation dossier').toBe(reads)
  })
})
