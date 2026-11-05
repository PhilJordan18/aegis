import type { Page, Route } from '@playwright/test'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * Routed fakes for the production Équipements page in the offline projects (a11y, capture,
 * identity): the browser never reaches a real API. The dev server proxy would send /api to
 * 127.0.0.1:8080; these routes answer first, so no request leaves the page. The live recipe is
 * api.spec.ts, run by `npm run test:e2e:api`.
 */
export type CatalogMode = 'nominal' | 'long' | 'loading' | 'empty' | 'serviceError' | 'forbidden' | 'unreachable' | 'paged' | 'staleDossier'

const EVALUATED_AT = '2026-10-21T14:30:00Z'
const MODEL_ID = '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01'

interface Unit {
  id: string
  assetCode: string
  name: string
  manufacturer: string | null
  modelNumber: string | null
  serialNumber: string | null
  calibrationStatus: 'NOT_REQUIRED' | 'VALID' | 'EXPIRED' | 'UNKNOWN'
  dueAt: string | null
  reasons: string[]
  operationalStatus?: 'SERVICEABLE' | 'MAINTENANCE' | 'DAMAGED'
}

const unitId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const NOMINAL: Unit[] = [
  { id: unitId(1), assetCode: 'MM-001', name: 'Multimètre 1', manufacturer: 'Fluke', modelNumber: '117', serialNumber: null, calibrationStatus: 'VALID', dueAt: '2026-12-01T05:00:00Z', reasons: ['UNKNOWN_PHYSICAL_STATE'] },
  {
    id: unitId(2),
    assetCode: 'MM-002',
    name: 'Multimètre 2',
    manufacturer: 'Fluke',
    modelNumber: '117',
    serialNumber: 'FL-117-0042',
    calibrationStatus: 'EXPIRED',
    dueAt: '2026-09-08T04:00:00Z',
    reasons: ['CALIBRATION_EXPIRED', 'UNKNOWN_PHYSICAL_STATE'],
  },
]

// Long French content: names that wrap, a serial number with no break point, every reason at once.
const LONG: Unit[] = [
  {
    id: unitId(11),
    assetCode: 'ANALYSEUR-SPECTRE-PORTATIF-001',
    name: 'Analyseur de spectre portatif à large bande avec générateur de suivi et antenne directionnelle intégrée',
    manufacturer: 'Keysight Technologies Canada',
    modelNumber: 'N9344C-HAND-HELD-SPECTRUM-ANALYZER-20GHZ',
    serialNumber: 'MY5812345678901234567890123456789012',
    calibrationStatus: 'EXPIRED',
    dueAt: '2026-09-08T04:00:00Z',
    operationalStatus: 'DAMAGED',
    reasons: ['NOT_PRESENT', 'NOT_AVAILABLE', 'DAMAGED', 'CALIBRATION_EXPIRED', 'UNKNOWN_PHYSICAL_STATE'],
  },
  { id: unitId(12), assetCode: 'OSC-014', name: 'Oscilloscope numérique à signaux mixtes', manufacturer: null, modelNumber: null, serialNumber: null, calibrationStatus: 'UNKNOWN', dueAt: null, operationalStatus: 'MAINTENANCE', reasons: ['MAINTENANCE', 'UNKNOWN_PHYSICAL_STATE'] },
  { id: unitId(13), assetCode: 'TH-203', name: 'Thermomètre infrarouge', manufacturer: 'Testo', modelNumber: '830-T2', serialNumber: 'T2-98765', calibrationStatus: 'NOT_REQUIRED', dueAt: null, reasons: ['UNKNOWN_PHYSICAL_STATE'] },
]

const PAGED: Unit[] = Array.from({ length: 25 }, (_, index) => ({
  id: unitId(100 + index),
  assetCode: `MM-${String(index + 1).padStart(3, '0')}`,
  name: `Multimètre ${index + 1}`,
  manufacturer: 'Fluke',
  modelNumber: '117',
  serialNumber: null,
  calibrationStatus: 'VALID' as const,
  dueAt: '2026-12-01T05:00:00Z',
  reasons: ['UNKNOWN_PHYSICAL_STATE'],
}))

function view(unit: Unit) {
  return {
    id: unit.id,
    assetCode: unit.assetCode,
    serialNumber: unit.serialNumber,
    model: { id: MODEL_ID, name: unit.name, manufacturer: unit.manufacturer, modelNumber: unit.modelNumber },
    requiredAccessLevel: 'STANDARD',
    operationalStatus: unit.operationalStatus ?? 'SERVICEABLE',
    calibration: { required: unit.calibrationStatus !== 'NOT_REQUIRED', dueAt: unit.dueAt, status: unit.calibrationStatus },
    availability: 'AVAILABLE',
    presence: 'UNKNOWN',
    placement: null,
    operationalDiagnostic: { evaluatedAt: EVALUATED_AT, reasons: unit.reasons },
    archivedAt: null,
  }
}

const SIZE = 20

function problem(status: number, code: string, instance: string) {
  return { type: `https://aegis.local/problems/${code.toLowerCase()}`, title: 'Fictif', status, code, detail: 'Détail serveur fictif, jamais affiché.', instance, traceId: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30', timestamp: EVALUATED_AT }
}

const json = (route: Route, status: number, body: unknown, type = 'application/json') =>
  route.fulfill({ status, contentType: type, headers: { 'X-Request-Id': '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30' }, body: JSON.stringify(body) })

export function unitsOf(mode: CatalogMode): Unit[] {
  return mode === 'long' ? LONG : mode === 'paged' ? PAGED : mode === 'empty' ? [] : NOMINAL
}

/** Answers /api/v1/admin/assets and /api/v1/admin/assets/{id} for one mode, and records the requests. */
export async function routeCatalog(page: Page, mode: CatalogMode): Promise<string[]> {
  const requests: string[] = []
  // staleDossier: each unit is read once, then the service fails, so a later refresh leaves the dossier stale.
  const unitReads = new Map<string, number>()
  await page.route('**/api/v1/admin/assets**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`)
    if (mode === 'loading') return new Promise<void>(() => {})
    if (mode === 'unreachable') return route.abort('connectionrefused')
    if (mode === 'forbidden') return json(route, 403, problem(403, 'FORBIDDEN', url.pathname), 'application/problem+json')
    if (mode === 'serviceError') return json(route, 500, problem(500, 'INTERNAL_ERROR', url.pathname), 'application/problem+json')
    const units = unitsOf(mode)
    const byId = url.pathname.match(/\/admin\/assets\/([^/]+)$/)
    if (byId) {
      const reads = (unitReads.get(byId[1] ?? '') ?? 0) + 1
      unitReads.set(byId[1] ?? '', reads)
      if (mode === 'staleDossier' && reads > 1) return json(route, 503, problem(503, 'SERVICE_UNAVAILABLE', url.pathname), 'application/problem+json')
      const unit = units.find((candidate) => candidate.id === byId[1])
      return unit ? json(route, 200, view(unit)) : json(route, 404, problem(404, 'RESOURCE_NOT_FOUND', url.pathname), 'application/problem+json')
    }
    const index = Math.max(Number(url.searchParams.get('page') ?? '0'), 0)
    const items = units.slice(index * SIZE, index * SIZE + SIZE).map(view)
    return json(route, 200, { items, page: index, size: SIZE, totalItems: units.length, totalPages: Math.ceil(units.length / SIZE) })
  })
  return requests
}

/**
 * Signs in through the preview gateway (fake, in memory), then moves to the production /equipements
 * route without a reload, so the session survives. `english` follows the browser language.
 */
export async function openCatalog(page: Page, mode: CatalogMode, { english = false }: { english?: boolean } = {}): Promise<string[]> {
  const requests = await routeCatalog(page, mode)
  await page.getByLabel(english ? 'Email address' : 'Adresse courriel').fill(PREVIEW_EMAIL)
  await page.getByLabel(english ? 'Password' : 'Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
  await page.getByRole('button', { name: english ? 'Sign in' : 'Se connecter' }).click()
  await page.waitForURL(/\/apercu\/equipements$/)
  await page.evaluate(() => {
    window.history.pushState(null, '', '/equipements')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForURL(/\/equipements$/)
  return requests
}

/** The state each mode must reach before the page is inspected. */
export async function waitForCatalogState(page: Page, mode: CatalogMode, { english = false }: { english?: boolean } = {}) {
  const long = { timeout: 20_000 }
  switch (mode) {
    case 'nominal':
    case 'long':
    case 'paged':
      await page.getByRole('heading', { level: 2, name: english ? /^(\d+) units$/ : /^(\d+) exemplaires$/ }).waitFor()
      await page.locator('.ag-dossier__title').waitFor()
      break
    case 'staleDossier':
      await page.getByRole('heading', { level: 2, name: english ? /^(\d+) units$/ : /^(\d+) exemplaires$/ }).waitFor()
      await page.locator('.ag-dossier__title').waitFor()
      await makeDossierStale(page, english)
      break
    case 'loading':
      await page.locator('.ag-skel').first().waitFor()
      break
    case 'empty':
      await page.getByText(english ? 'No units.' : 'Aucun exemplaire.').waitFor()
      break
    case 'serviceError':
    case 'unreachable':
      await page.getByRole('alert').waitFor(long)
      break
    case 'forbidden':
      await page.getByRole('alert').waitFor()
      break
  }
}

/**
 * Lets the selected unit's cached copy go stale and fires the visibility refetch: the second read of
 * the unit fails (routeCatalog), so the dossier keeps the unit and shows the stale notice.
 */
export async function makeDossierStale(page: Page, english: boolean) {
  await page.clock.install()
  await page.clock.fastForward(60_000)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
  // The failed read is retried twice with a growing delay before it counts as failed.
  await page.clock.fastForward(10_000)
  await page.locator('.ag-dossier [role="alert"]').getByText(english ? 'Data not refreshed.' : 'Données non actualisées.').waitFor({ timeout: 20_000 })
}
