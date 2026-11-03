import type { Page, Route } from '@playwright/test'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD } from './support.ts'

/**
 * Routed fakes for the production Casiers page in the offline projects (a11y, capture, identity): the
 * browser never reaches a real API. Two routes answer, both read only: the catalog list that places a unit
 * in the demo locker (how the page finds it), and `GET /api/v1/lockers/{id}/status`. The live recipe is
 * api.spec.ts, run by `npm run test:e2e:api`.
 */
export type LockerMode = 'nominal' | 'offline' | 'unknown' | 'closed' | 'noSchedule' | 'faulted' | 'long' | 'code20' | 'code24' | 'codeUnbroken' | 'offlineLong' | 'loading' | 'notFound' | 'serviceError' | 'unreachable' | 'stale'

export const DEMO_LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
// Mid-afternoon in Toronto: the heartbeat is seconds old, the window closes at 17 h.
const EVALUATED_AT = '2026-11-03T19:00:00Z'

// One distinct id per code: the page keys its rows by compartment id.
const compartmentId = (code: string) => `6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a${[...code].map((char) => char.charCodeAt(0).toString(16)).join('').padStart(4, '0').slice(-4)}`.padEnd(36, '0')

const compartment = (code: string, overrides: Record<string, unknown> = {}) => ({
  id: compartmentId(code),
  code,
  enabled: true,
  connectionStatus: 'CONNECTED',
  rfidReaderStatus: 'HEALTHY',
  doorState: 'CLOSED',
  lockState: 'LOCKED',
  lastObservedAt: '2026-11-03T18:59:50Z',
  ...overrides,
})

function status(mode: LockerMode) {
  const base = {
    lockerId: DEMO_LOCKER_ID,
    code: 'AEGIS-DEMO-01',
    name: 'Laboratoire de démonstration',
    topology: 'HUB_CELL',
    connectionStatus: 'ONLINE',
    lastSeenAt: '2026-11-03T18:59:55Z',
    evaluatedAt: EVALUATED_AT,
    currentWindow: { timeZone: 'America/Toronto', open: true, closesAt: '2026-11-03T22:00:00Z', nextOpensAt: null },
    compartments: [compartment('A1'), compartment('A2')],
  }
  switch (mode) {
    case 'offline': {
      // As the server sends it: the cells keep the values of the last heartbeat, which is also the hub's last signal.
      const kept = { lastObservedAt: '2026-11-03T18:31:50Z' }
      return { ...base, connectionStatus: 'OFFLINE', lastSeenAt: '2026-11-03T18:32:00Z', compartments: [compartment('A1', kept), compartment('A2', kept)] }
    }
    case 'unknown': {
      const never = { connectionStatus: 'UNKNOWN', rfidReaderStatus: 'UNKNOWN', doorState: 'UNKNOWN', lockState: 'UNKNOWN', lastObservedAt: null }
      return { ...base, connectionStatus: 'UNKNOWN', lastSeenAt: null, compartments: [compartment('A1', never), compartment('A2', never)] }
    }
    case 'closed':
      return { ...base, currentWindow: { timeZone: 'America/Toronto', open: false, closesAt: null, nextOpensAt: '2026-11-04T13:00:00Z' } }
    case 'noSchedule':
      return { ...base, currentWindow: { timeZone: null, open: false, closesAt: null, nextOpensAt: null } }
    case 'faulted':
      return { ...base, compartments: [compartment('A1', { doorState: 'OPEN', lockState: 'UNLOCKED' }), compartment('A2', { rfidReaderStatus: 'FAULTED', enabled: false })] }
    case 'codeUnbroken':
      // The longest kind of valid code: free text with no break point at all.
      return { ...base, code: 'LABORATOIRENORDCASIERPRINCIPALDEMAINTENANCEETINSPECTIONDESEQUIPEMENTSDEMESUREDEPRECISION0001' }
    case 'offlineLong': {
      // Offline, with everything long at once: the code, the name, the cell codes, and faults the server kept from its last heartbeat.
      const kept = { lastObservedAt: '2026-11-03T18:31:50Z' }
      return {
        ...base,
        name: 'Laboratoire de maintenance et d’inspection des équipements de mesure de précision, aile nord',
        code: 'LAB-NORD-CASIER-PRINC-01',
        connectionStatus: 'OFFLINE',
        lastSeenAt: '2026-11-03T18:32:00Z',
        compartments: [
          compartment('CELLULE-GAUCHE-SUPERIEURE-AVEC-UN-CODE-TRES-LONG-0001', { ...kept, rfidReaderStatus: 'FAULTED', doorState: 'OPEN', lockState: 'UNLOCKED', connectionStatus: 'DISCONNECTED' }),
          compartment('CELLULE-DROITE-INFERIEURE-AVEC-UN-CODE-TRES-LONG-0002', { ...kept, enabled: false, rfidReaderStatus: 'FAULTED' }),
        ],
      }
    }
    case 'code20':
      return { ...base, code: 'LAB-NORD-CASIER-0001' }
    case 'code24':
      return { ...base, code: 'LAB-NORD-CASIER-PRINC-01' }
    case 'long':
      // Long French content: a name that wraps, a code with no break point, many compartments with every exception.
      return {
        ...base,
        name: 'Laboratoire de maintenance et d’inspection des équipements de mesure de précision, aile nord',
        code: 'AEGIS-LABORATOIRE-MAINTENANCE-ET-INSPECTION-DEMO-0001',
        compartments: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map((code, index) =>
          compartment(code, index % 2 === 0 ? { doorState: 'OPEN', lockState: 'UNLOCKED', rfidReaderStatus: 'FAULTED' } : { connectionStatus: 'DISCONNECTED', enabled: false, lastObservedAt: null }),
        ),
      }
    default:
      return base
  }
}

const problem = (status: number, code: string, instance: string) => ({
  type: `https://aegis.local/problems/${code.toLowerCase()}`,
  title: 'Fictif',
  status,
  code,
  detail: 'Détail serveur fictif, jamais affiché.',
  instance,
  traceId: TRACE_ID,
  timestamp: EVALUATED_AT,
})

const json = (route: Route, statusCode: number, body: unknown, type = 'application/json') =>
  route.fulfill({ status: statusCode, contentType: type, headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })

const PLACED_UNIT = {
  id: '00000000-0000-4000-8000-000000000001',
  assetCode: 'MM-001',
  serialNumber: null,
  model: { id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a01', name: 'Multimètre 1', manufacturer: 'Fluke', modelNumber: '117' },
  requiredAccessLevel: 'STANDARD',
  operationalStatus: 'SERVICEABLE',
  calibration: { required: true, dueAt: '2026-12-01T05:00:00Z', status: 'VALID' },
  availability: 'AVAILABLE',
  presence: 'UNKNOWN',
  placement: { lockerId: DEMO_LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: compartmentId('A1'), compartmentCode: 'A1' },
  operationalDiagnostic: { evaluatedAt: EVALUATED_AT, reasons: ['UNKNOWN_PHYSICAL_STATE'] },
  archivedAt: null,
}

/** Pages whose service was broken on purpose (`stale`): a counter would also count the development double mount. */
const broken = new WeakSet<Page>()

/** Answers the two routes for one mode and records every request, so a test can prove nothing else was asked. */
export async function routeLockers(page: Page, mode: LockerMode): Promise<string[]> {
  const requests: string[] = []
  const record = (route: Route) => {
    const url = new URL(route.request().url())
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`)
    return url
  }
  await page.route('**/api/v1/admin/assets**', (route) => {
    record(route)
    return json(route, 200, { items: [PLACED_UNIT], page: 0, size: 20, totalItems: 1, totalPages: 1 })
  })
  // stale: the reads succeed until `makeStatusStale` breaks the service, so a later refresh leaves the data stale.
  await page.route('**/api/v1/lockers/*/status', (route) => {
    const url = record(route)
    if (mode === 'loading') return new Promise<void>(() => {})
    if (mode === 'unreachable') return route.abort('connectionrefused')
    if (mode === 'notFound') return json(route, 404, problem(404, 'RESOURCE_NOT_FOUND', url.pathname), 'application/problem+json')
    if (mode === 'serviceError') return json(route, 500, problem(500, 'INTERNAL_ERROR', url.pathname), 'application/problem+json')
    if (mode === 'stale' && broken.has(page)) return json(route, 503, problem(503, 'SERVICE_UNAVAILABLE', url.pathname), 'application/problem+json')
    return json(route, 200, status(mode))
  })
  return requests
}

/**
 * Signs in through the preview gateway (fake, in memory), then moves to the production /casiers route
 * without a reload, so the session survives. `english` follows the browser language.
 */
export async function openLockers(page: Page, mode: LockerMode, { english = false }: { english?: boolean } = {}): Promise<string[]> {
  const requests = await routeLockers(page, mode)
  await page.getByLabel(english ? 'Email address' : 'Adresse courriel').fill(PREVIEW_EMAIL)
  await page.getByLabel(english ? 'Password' : 'Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
  await page.getByRole('button', { name: english ? 'Sign in' : 'Se connecter' }).click()
  await page.waitForURL(/\/apercu\/equipements$/)
  await page.evaluate(() => {
    window.history.pushState(null, '', '/casiers')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForURL(/\/casiers$/)
  return requests
}

/** The state each mode must reach before the page is inspected. */
export async function waitForLockerState(page: Page, mode: LockerMode, { english = false }: { english?: boolean } = {}) {
  const long = { timeout: 20_000 }
  switch (mode) {
    case 'loading':
      await page.locator('.ag-skel__bar').first().waitFor()
      break
    case 'notFound':
    case 'serviceError':
    case 'unreachable':
      await page.getByRole('alert').waitFor(long)
      break
    case 'stale':
      await page.locator('.ag-lk__title').waitFor()
      await makeStatusStale(page, english)
      break
    default:
      await page.locator('.ag-lk__title').waitFor()
      await page.locator('.ag-lk-table-wrap, .ag-lk__body .ag-help').first().waitFor()
  }
}

/**
 * Lets the refresh interval fire: the next read fails (routeLockers), so the panel keeps the last good
 * data and shows the stale notice. The failed read is retried twice with a growing delay before it counts.
 */
export async function makeStatusStale(page: Page, english: boolean) {
  broken.add(page)
  await page.clock.install()
  await page.clock.fastForward(16_000)
  await page.clock.fastForward(10_000)
  await page.locator('.ag-lk [role="alert"]').getByText(english ? 'Data not refreshed.' : 'Données non actualisées.').waitFor({ timeout: 20_000 })
}
