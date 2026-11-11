import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { parseAnomalyView } from '../features/anomalies/contractParsers'
import type { AnomalyPage } from '../features/anomalies/contract'
import { anomalyPageOf, anomalyView, fakeAnomalyGateway } from '../features/anomalies/testFixtures'
import { unconfiguredAuthGateway, type AuthGateway, type GatewayResult } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { AdminLockerPage, AdminLockerView } from '../features/custody/contract'
import { fakeCustodyGateway } from '../features/custody/testFixtures'
import type { LockerStatus } from '../features/lockers/contract'
import { A1, A2, DEMO_LOCKER_ID, lockerStatus, NEVER_SEEN, OFFLINE } from '../features/lockers/testFixtures'
import { LOCKER_STATUS_REFRESH_MS } from '../features/lockers/useLockerStatus'
import { IN_PROGRESS_OPERATION_STATUSES } from '../features/overview/overviewModel'
import { parseLoanView, parseLockerOperationView, parseReservationView } from '../features/transactions/contractParsers'
import type { LoanStatus, LoanView, LockerOperationStatus, LockerOperationView, ReservationView, TransactionPage } from '../features/transactions/contract'
import { ASSET_ID, loanView, lockerOperationView, reservationView } from '../features/transactions/testFixtures'
import type { TransactionGateway } from '../features/transactions/transactionGateway'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

configure({ asyncUtilTimeout: 4000 })

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const ok = <T,>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-ov' })
const problem = (status: number, code: string, traceId = 'trace-0001') => ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId }), retryAfter: null, requestId: 'req-x' }) as const
const offline = { kind: 'network', reason: 'offline' } as const

const must = <T,>(value: T | null): T => {
  if (value === null) throw new Error('fixture breaks the contract')
  return value
}
const anomaly = (overrides: Record<string, unknown> = {}) => must(parseAnomalyView(anomalyView({ compartmentId: A1.id, ...overrides })))
const reservation = (overrides: Record<string, unknown> = {}): ReservationView => must(parseReservationView(reservationView(overrides)))
const loan = (overrides: Record<string, unknown> = {}): LoanView => must(parseLoanView(loanView(overrides)))
const operation = (overrides: Record<string, unknown> = {}): LockerOperationView => must(parseLockerOperationView(lockerOperationView({ status: 'COMMAND_ACKNOWLEDGED', terminalAt: null, confirmedAt: null, compartmentId: A1.id, expiresAt: '2026-11-10T19:13:00Z', ...overrides })))
const pageOf = <T,>(items: T[], totalItems = items.length): TransactionPage<T> => ({ items, page: 0, size: 100, totalItems, totalPages: totalItems > items.length ? 2 : 1 })
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ADMIN_LOCKER: AdminLockerView = {
  id: DEMO_LOCKER_ID,
  code: 'AEGIS-DEMO-01',
  name: 'Casier de démonstration',
  topology: 'HUB_CELL',
  compartments: [
    { id: A1.id, code: 'A1', enabled: true, currentAsset: { id: ASSET_ID, assetCode: 'MM-001' } },
    { id: A2.id, code: 'A2', enabled: true, currentAsset: null },
  ],
}
const lockerPage = (items: AdminLockerView[] = [ADMIN_LOCKER]): AdminLockerPage => ({ items, page: 0, size: 100, totalItems: items.length, totalPages: 1 })

type Answer<T> = GatewayResult<T> | (() => Promise<GatewayResult<T>>)
const resolve = async <T,>(answer: Answer<T>): Promise<GatewayResult<T>> => (typeof answer === 'function' ? answer() : answer)

interface Script {
  anomalies?: Answer<AnomalyPage>
  loans?: Partial<Record<LoanStatus, Answer<TransactionPage<LoanView>>>>
  operations?: Partial<Record<LockerOperationStatus, Answer<TransactionPage<LockerOperationView>>>>
  reservations?: Answer<TransactionPage<ReservationView>>
  lockers?: Answer<AdminLockerPage>
  status?: Answer<LockerStatus>
}

/** The nominal lab of the design: one high anomaly, one overdue loan, one operation in progress, one active reservation. */
const NOMINAL: Required<Script> = {
  anomalies: ok(anomalyPageOf([anomaly()])),
  loans: { ACTIVE: ok(pageOf([])), RETURN_PENDING: ok(pageOf([loan({ id: id(1), status: 'RETURN_PENDING', overdue: true, dueAt: '2026-11-10T17:30:00Z' })])) },
  operations: { COMMAND_ACKNOWLEDGED: ok(pageOf([operation({ id: id(2) })])) },
  reservations: ok(pageOf([reservation({ id: id(3), reservedUntil: '2026-11-10T21:30:00Z' })])),
  lockers: ok(lockerPage()),
  status: ok(lockerStatus()),
}

function gateways(script: Script = {}) {
  const s = { ...NOMINAL, ...script }
  const transactionGateway = {
    listReservations: vi.fn(async () => resolve(s.reservations)),
    getReservation: vi.fn(async () => offline),
    listLoans: vi.fn(async (_token: string, query: { status?: LoanStatus }) => resolve(s.loans[query.status as LoanStatus] ?? ok(pageOf<LoanView>([])))),
    getLoan: vi.fn(async () => offline),
    listLockerOperations: vi.fn(async (_token: string, query: { status?: LockerOperationStatus }) => resolve(s.operations[query.status as LockerOperationStatus] ?? ok(pageOf<LockerOperationView>([])))),
    getLockerOperation: vi.fn(async () => offline),
  }
  const anomalyGateway = fakeAnomalyGateway({ listAnomalies: async () => resolve(s.anomalies) })
  const custodyGateway = fakeCustodyGateway({ listLockers: async () => resolve(s.lockers) })
  const lockerGateway = { getStatus: vi.fn(async () => resolve(s.status)) }
  return { transactionGateway: transactionGateway as unknown as TransactionGateway & typeof transactionGateway, anomalyGateway, custodyGateway, lockerGateway }
}

function renderWith(fakes = gateways(), options: { locale?: Locale; url?: string } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-11-11T20:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', options.url ?? '/vue-d-ensemble')
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const rendered = renderWithProviders(<App />, { gateway: authGateway, session, queryClient, locale: options.locale ?? 'fr', ...fakes })
  return { ...rendered, fakes, queryClient }
}

const block = (name: string) => screen.getByRole('region', { name })
const blockText = (name: string) => plain(block(name).textContent)

beforeEach(() => {
  installMatchMedia(window, false)
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe("Vue d'ensemble: the five blocks", () => {
  it('shows the blocks in the priority order, with the server counts and the rows the design approves', async () => {
    renderWith()
    expect(await screen.findByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeDefined()
    expect(document.title).toBe("Vue d'ensemble — Aegis Manager")
    await waitFor(() => expect(blockText('Anomalies ouvertes')).toContain('1 ouverte'))
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Anomalies ouvertes', 'Prêts en retard', 'Casier', 'Opération en cours', 'Réservations actives'])

    const anomalies = blockText('Anomalies ouvertes')
    expect(anomalies).toContain('Gravité élevée')
    expect(anomalies).toContain('Équipement attendu non observé')
    // Cell code and equipment code come from the locker list (G3), the detection time from the lab zone.
    expect(anomalies).toContain('Cellule A1 · MM-001 · Détectée')

    await waitFor(() => expect(blockText('Prêts en retard')).toContain('1 observé en retard'))
    const loans = blockText('Prêts en retard')
    expect(loans).toContain('Retour en cours')
    expect(loans).toContain('En retard')
    expect(loans).toContain('En retard depuis')
    expect(loans).toContain('Titulaire : Technicien Démo')

    await waitFor(() => expect(blockText('Casier')).toContain('AEGIS-DEMO-01'))
    const locker = blockText('Casier')
    expect(locker).toContain('En ligne')
    expect(locker).toContain('Fermée')
    expect(locker).toContain('Verrouillée')
    expect(locker).toContain('MM-001')
    expect(locker).toContain('Aucun équipement placé')
    expect(locker).toContain("Cette lecture n'autorise aucune ouverture.")

    await waitFor(() => expect(blockText('Opération en cours')).toContain('1 observée en cours'))
    const operations = blockText('Opération en cours')
    expect(operations).toContain('Commande acquittée')
    expect(operations).toContain('Retrait · MM-001')
    expect(operations).toContain('Cellule A1 · Expire à 14 h 13')
    expect(operations).toContain("Un accusé de commande ne prouve ni le déverrouillage ni l'ouverture.")

    await waitFor(() => expect(blockText('Réservations actives')).toContain('1 active'))
    expect(blockText('Réservations actives')).toContain('Jusqu’à')
  })

  it('links every row and every foot into the page that owns the dossier, and offers no corrective action', async () => {
    renderWith()
    await waitFor(() => expect(blockText('Réservations actives')).toContain('1 active'))
    await waitFor(() => expect(blockText('Opération en cours')).toContain('1 observée en cours'))
    const hrefs = (name: string) => within(block(name)).getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs('Anomalies ouvertes')).toEqual([`/anomalies?anomalie=8a9b0c1d-2e3f-4a5b-9c6d-7e8f9a0b1c2d`, '/anomalies'])
    expect(hrefs('Prêts en retard')).toEqual([`/reservations-prets?vue=prets&dossier=${id(1)}`, '/reservations-prets?vue=prets'])
    expect(hrefs('Casier')).toEqual(['/casiers'])
    expect(hrefs('Opération en cours')).toEqual([`/reservations-prets?vue=operations&dossier=${id(2)}`, '/reservations-prets?vue=operations'])
    expect(hrefs('Réservations actives')).toEqual([`/reservations-prets?statut=ACTIVE&dossier=${id(3)}`, '/reservations-prets?statut=ACTIVE'])

    const main = document.querySelector('main') as HTMLElement
    const buttons = within(main).queryAllByRole('button').map((button) => plain(button.textContent))
    expect(buttons).toEqual(['Actualiser'])
    expect(plain(main.textContent)).not.toMatch(/terminer|confirmer le|forcer|ouvrir la|résoudre|reconnaître|annuler|supprimer|CANCEL_RESERVATION/i)
  })

  it('tabs through the links in the priority order of the blocks', async () => {
    const user = userEvent.setup()
    renderWith()
    await waitFor(() => expect(blockText('Réservations actives')).toContain('1 active'))
    await waitFor(() => expect(blockText('Opération en cours')).toContain('1 observée en cours'))
    const links = [...document.querySelectorAll<HTMLAnchorElement>('main a[href]')].map((link) => link.getAttribute('href'))
    expect(links.map((href) => href?.split('?')[0])).toEqual(['/anomalies', '/anomalies', '/reservations-prets', '/reservations-prets', '/casiers', '/reservations-prets', '/reservations-prets', '/reservations-prets', '/reservations-prets'])
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Aller au contenu principal')
  })

  it('reads each route once at the widths the contract allows, with no sort and no invented filter', async () => {
    const fakes = gateways()
    renderWith(fakes)
    await waitFor(() => expect(blockText('Casier')).toContain('En ligne'))
    await waitFor(() => expect(fakes.transactionGateway.listLockerOperations).toHaveBeenCalledTimes(7))
    expect(fakes.anomalyGateway.listAnomalies.mock.calls.map((call) => call[1])).toEqual([{ status: 'OPEN', page: 0, size: 100 }])
    expect(fakes.transactionGateway.listLoans.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { status: 'ACTIVE', page: 0, size: 100 },
      { status: 'RETURN_PENDING', page: 0, size: 100 },
    ])
    expect(fakes.transactionGateway.listLockerOperations.mock.calls.map((call) => (call as unknown[])[1])).toEqual(IN_PROGRESS_OPERATION_STATUSES.map((status) => ({ status, page: 0, size: 100 })))
    expect(fakes.transactionGateway.listReservations.mock.calls.map((call) => (call as unknown[])[1])).toEqual([{ status: 'ACTIVE', page: 0, size: 5 }])
    expect(fakes.custodyGateway.listLockers).toHaveBeenCalledTimes(1)
    expect(fakes.lockerGateway.getStatus).toHaveBeenCalledTimes(1)
    // No detail read and no write: the page lists, it does not open or change anything.
    expect(fakes.transactionGateway.getReservation).not.toHaveBeenCalled()
    expect(fakes.transactionGateway.getLoan).not.toHaveBeenCalled()
    expect(fakes.transactionGateway.getLockerOperation).not.toHaveBeenCalled()
    expect(fakes.anomalyGateway.getAnomaly).not.toHaveBeenCalled()
    expect(fakes.anomalyGateway.acknowledge).not.toHaveBeenCalled()
  })

  it('says when it was updated in the laboratory zone, and which zone that is', async () => {
    renderWith()
    await waitFor(() => expect(document.querySelector('.ag-page__time')?.textContent).toMatch(/^Mis à jour à /))
    expect(plain(document.querySelector('.ag-page__time')?.textContent)).toMatch(/\b(HNE|HAE)\b/)
    expect(plain(document.querySelector('main')?.textContent)).toContain('Heures du laboratoire : America/Toronto')
  })
})

describe("Vue d'ensemble: authoritative counts", () => {
  it('counts the anomalies with the server total, not with the rows it previews', async () => {
    renderWith(gateways({ anomalies: ok(anomalyPageOf([anomaly({ id: id(10) }), anomaly({ id: id(11) })], { totalItems: 12, totalPages: 1 })) }))
    await waitFor(() => expect(blockText('Anomalies ouvertes')).toContain('12 ouvertes'))
    expect(blockText('Anomalies ouvertes')).toContain('Affichage de 2 sur 12.')
  })

  it('previews five rows of a longer list and says how many exist', async () => {
    const many = Array.from({ length: 8 }, (_, index) => anomaly({ id: id(20 + index) }))
    renderWith(gateways({ anomalies: ok(anomalyPageOf(many)) }))
    await waitFor(() => expect(blockText('Anomalies ouvertes')).toContain('8 ouvertes'))
    expect(within(block('Anomalies ouvertes')).getAllByRole('link')).toHaveLength(6)
    expect(blockText('Anomalies ouvertes')).toContain('Affichage de 5 sur 8.')
  })

  it('counts the reservations with the server total, and the operations as the distinct ones observed', async () => {
    renderWith(
      gateways({
        reservations: ok(pageOf([reservation({ id: id(3) })], 14)),
        operations: { REQUESTED: ok(pageOf([operation({ id: id(4), status: 'REQUESTED' })], 1)), DOOR_OPENED: ok(pageOf([operation({ id: id(5), status: 'DOOR_OPENED' })], 1)) },
      }),
    )
    await waitFor(() => expect(blockText('Réservations actives')).toContain('14 actives'))
    await waitFor(() => expect(blockText('Opération en cours')).toContain('2 observées en cours'))
    expect(blockText('Opération en cours')).toContain('Porte ouverte')
    expect(blockText('Opération en cours')).toContain("Chaque statut est lu par une requête distincte, pas au même instant : un élément qui change de statut entre deux lectures n'est compté qu'une fois, et peut manquer.")
  })

  it('shows one operation, not an exact 2, when it changed status between the two reads that saw it', async () => {
    renderWith(
      gateways({
        operations: { AUTHORIZED: ok(pageOf([operation({ id: id(4), status: 'AUTHORIZED' })], 1)), COMMAND_SENT: ok(pageOf([operation({ id: id(4), status: 'COMMAND_SENT' })], 1)) },
      }),
    )
    await waitFor(() => expect(blockText('Opération en cours')).toContain('1 observée en cours'))
    const operations = blockText('Opération en cours')
    expect(operations).not.toMatch(/\b2\b.*en cours/)
    expect(within(block('Opération en cours')).getAllByRole('link')).toHaveLength(2)
  })

  it('gives no total of operations when a status holds more than one page', async () => {
    renderWith(gateways({ operations: { REQUESTED: ok(pageOf([operation({ id: id(4), status: 'REQUESTED' })], 240)) } }))
    await waitFor(() => expect(blockText('Opération en cours')).toContain('1 en cours parmi les opérations lues'))
    expect(blockText('Opération en cours')).toContain('Un état compte plus de 100 opérations : seules les plus récentes ont été lues.')
    expect(blockText('Opération en cours')).not.toContain('240')
  })

  it('takes the overdue loans from the server flag: a loan past its due date that the server does not flag is not overdue', async () => {
    renderWith(gateways({ loans: { ACTIVE: ok(pageOf([loan({ id: id(6), overdue: false, dueAt: '2020-01-01T00:00:00Z' })])), RETURN_PENDING: ok(pageOf([])) } }))
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('Aucun prêt en retard observé.'))
    expect(blockText('Prêts en retard')).not.toContain('En retard depuis')
  })

  it('covers only the loans read, never a total, when one loan status could not be read', async () => {
    renderWith(gateways({ loans: { ACTIVE: ok(pageOf([loan({ id: id(6), overdue: true })])), RETURN_PENDING: offline } }))
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('1 en retard parmi les prêts lus'))
    const loans = blockText('Prêts en retard')
    expect(loans).toContain('Lecture incomplète.')
    expect(loans).toContain('Les prêts au statut Retour en cours n\'ont pas pu être lus. Le nombre affiché ne porte que sur les prêts lus.')
    expect(within(block('Prêts en retard')).getByRole('button', { name: 'Réessayer' })).toBeDefined()
  })

  it('covers only the loans read when a status holds more loans than the page read, and never « none » for an unread remainder', async () => {
    renderWith(gateways({ loans: { ACTIVE: ok(pageOf([loan({ id: id(6), overdue: false })], 240)), RETURN_PENDING: ok(pageOf([])) } }))
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('Aucun retard dans les prêts lus.'))
    const loans = blockText('Prêts en retard')
    expect(loans).not.toContain('Aucun prêt en retard observé.')
    expect(loans).toContain('Seuls 1 prêts sur 240 ont été lus, les plus récents. Le nombre affiché ne porte que sur les prêts lus.')
  })

  it('covers only the operations read, and names how many statuses could not be read', async () => {
    renderWith(gateways({ operations: { REQUESTED: ok(pageOf([operation({ id: id(4), status: 'REQUESTED' })], 1)), AUTHORIZED: problem(500, 'INTERNAL_ERROR'), COMMAND_SENT: offline } }))
    await waitFor(() => expect(blockText('Opération en cours')).toContain('1 en cours parmi les opérations lues'))
    expect(blockText('Opération en cours')).toContain("2 des 7 états d'opération n'ont pas pu être lus. Le nombre affiché ne porte que sur les opérations lues.")
  })

  it('says « none » only when every read answered with nothing', async () => {
    renderWith(gateways({ anomalies: ok(anomalyPageOf([])), loans: { ACTIVE: ok(pageOf([])), RETURN_PENDING: ok(pageOf([])) }, operations: {}, reservations: ok(pageOf([])) }))
    await waitFor(() => expect(blockText('Anomalies ouvertes')).toContain('Aucune anomalie ouverte.'))
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('Aucun prêt en retard observé.'))
    await waitFor(() => expect(blockText('Opération en cours')).toContain('Aucune opération physique observée en cours.'))
    await waitFor(() => expect(blockText('Réservations actives')).toContain('Aucune réservation active.'))
    // The locker keeps its own line when everything else is clear.
    await waitFor(() => expect(blockText('Casier')).toContain('AEGIS-DEMO-01'))
  })
})

describe("Vue d'ensemble: independent blocks", () => {
  it('keeps the other blocks readable when one route fails, and shows the failure with its trace id instead of a zero', async () => {
    renderWith(gateways({ reservations: problem(500, 'INTERNAL_ERROR', 'trace-reservations') }))
    await waitFor(() => expect(blockText('Réservations actives')).toContain("Le service n'a pas pu fournir ces données."))
    const reservations = blockText('Réservations actives')
    expect(reservations).toContain('trace-reservations')
    expect(reservations).not.toContain('Aucune réservation active.')
    expect(reservations).not.toMatch(/\b0\b/)
    expect(within(block('Réservations actives')).queryByRole('link')).toBeNull()
    expect(blockText('Anomalies ouvertes')).toContain('1 ouverte')
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('1 observé en retard'))
    expect(blockText('Casier')).toContain('En ligne')
  })

  it('reads a 404 RESOURCE_NOT_FOUND of a list as a service error, never as « none » or « not yet available »', async () => {
    renderWith(gateways({ anomalies: problem(404, 'RESOURCE_NOT_FOUND', 'trace-404') }))
    await waitFor(() => expect(blockText('Anomalies ouvertes')).toContain("Le service n'a pas pu fournir ces données."))
    const anomalies = blockText('Anomalies ouvertes')
    expect(anomalies).toContain('trace-404')
    expect(anomalies).not.toContain('Aucune anomalie ouverte.')
    expect(anomalies).not.toMatch(/introuvable|bientôt|disponible/i)
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('1 observé en retard'))
  })

  it('shows a network failure of every loan read as unreachable, not as « no overdue loan »', async () => {
    renderWith(gateways({ loans: { ACTIVE: offline, RETURN_PENDING: offline } }))
    await waitFor(() => expect(blockText('Prêts en retard')).toContain('Connexion au service impossible.'))
    expect(blockText('Prêts en retard')).not.toContain('Aucun prêt en retard.')
    expect(blockText('Anomalies ouvertes')).toContain('1 ouverte')
  })

  it('retries only the failed block', async () => {
    const user = userEvent.setup()
    const fakes = gateways({ reservations: offline })
    renderWith(fakes)
    await waitFor(() => expect(blockText('Réservations actives')).toContain('Connexion au service impossible.'))
    expect(fakes.transactionGateway.listReservations).toHaveBeenCalledTimes(1)
    await user.click(within(block('Réservations actives')).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(fakes.transactionGateway.listReservations).toHaveBeenCalledTimes(2))
    expect(fakes.anomalyGateway.listAnomalies).toHaveBeenCalledTimes(1)
    expect(fakes.transactionGateway.listLoans).toHaveBeenCalledTimes(2)
  })

  it('shows the loading state of a block that is still waiting, while the others are already readable', async () => {
    let release: (value: GatewayResult<TransactionPage<ReservationView>>) => void = () => undefined
    const slow = () => new Promise<GatewayResult<TransactionPage<ReservationView>>>((resolveSlow) => (release = resolveSlow))
    renderWith(gateways({ reservations: slow }))
    await waitFor(() => expect(blockText('Anomalies ouvertes')).toContain('1 ouverte'))
    expect(block('Réservations actives').getAttribute('aria-busy')).toBe('true')
    expect(blockText('Réservations actives')).toContain('Chargement : Réservations actives')
    release(ok(pageOf([reservation()])))
    await waitFor(() => expect(blockText('Réservations actives')).toContain('1 active'))
    expect(block('Réservations actives').getAttribute('aria-busy')).toBeNull()
  })

  it('says it once when every block is refused (403), and shows no block', async () => {
    renderWith(
      gateways({
        anomalies: problem(403, 'FORBIDDEN'),
        loans: { ACTIVE: problem(403, 'FORBIDDEN'), RETURN_PENDING: problem(403, 'FORBIDDEN') },
        operations: Object.fromEntries(IN_PROGRESS_OPERATION_STATUSES.map((status) => [status, problem(403, 'FORBIDDEN')])),
        reservations: problem(403, 'FORBIDDEN'),
        lockers: problem(403, 'FORBIDDEN'),
      }),
    )
    expect(await screen.findByText("Votre compte n'a pas accès à la vue d'ensemble.")).toBeDefined()
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull()
  })

  it('says it once when every block is unreachable, with one retry that reads the failed routes again', async () => {
    const user = userEvent.setup()
    const fakes = gateways({
      anomalies: offline,
      loans: { ACTIVE: offline, RETURN_PENDING: offline },
      operations: Object.fromEntries(IN_PROGRESS_OPERATION_STATUSES.map((status) => [status, offline])),
      reservations: offline,
      lockers: offline,
    })
    renderWith(fakes)
    expect(await screen.findByText('Connexion au service impossible.')).toBeDefined()
    expect(screen.getAllByText('Connexion au service impossible.')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(fakes.anomalyGateway.listAnomalies).toHaveBeenCalledTimes(2))
  })

  it('shows each failing block with its own alert when the failures differ', async () => {
    renderWith(
      gateways({
        anomalies: offline,
        loans: { ACTIVE: problem(500, 'INTERNAL_ERROR'), RETURN_PENDING: problem(500, 'INTERNAL_ERROR') },
        operations: Object.fromEntries(IN_PROGRESS_OPERATION_STATUSES.map((status) => [status, offline])),
        reservations: offline,
        lockers: offline,
      }),
    )
    await waitFor(() => expect(blockText('Prêts en retard')).toContain("Le service n'a pas pu fournir ces données."))
    expect(blockText('Anomalies ouvertes')).toContain('Connexion au service impossible.')
    expect(screen.getAllByRole('region')).toHaveLength(5)
  })
})

describe("Vue d'ensemble: stale data and refresh", () => {
  it('keeps the data of a block whose refresh failed, with the time it was read and a retry', async () => {
    const user = userEvent.setup()
    let calls = 0
    renderWith(gateways({ reservations: async () => (++calls === 1 ? ok(pageOf([reservation()])) : offline) }))
    await waitFor(() => expect(blockText('Réservations actives')).toContain('1 active'))
    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(blockText('Réservations actives')).toContain('Données non actualisées.'))
    const reservations = blockText('Réservations actives')
    expect(reservations).toMatch(/Les données affichées ont été lues à \d+ h \d{2} (HNE|HAE)\. La dernière actualisation a échoué\./)
    // The old data stays, with its count, and the other blocks are not marked stale.
    expect(reservations).toContain('1 active')
    expect(within(block('Réservations actives')).getByRole('button', { name: 'Réessayer' })).toBeDefined()
    expect(blockText('Anomalies ouvertes')).not.toContain('Données non actualisées.')
  })

  it('reads every block again on « Actualiser », busy meanwhile, and announces the result', async () => {
    const user = userEvent.setup()
    const fakes = gateways()
    renderWith(fakes)
    await waitFor(() => expect(blockText('Réservations actives')).toContain('1 active'))
    await waitFor(() => expect(fakes.lockerGateway.getStatus).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(fakes.transactionGateway.listReservations).toHaveBeenCalledTimes(2))
    expect(fakes.anomalyGateway.listAnomalies).toHaveBeenCalledTimes(2)
    expect(fakes.transactionGateway.listLoans).toHaveBeenCalledTimes(4)
    expect(fakes.transactionGateway.listLockerOperations).toHaveBeenCalledTimes(14)
    expect(fakes.custodyGateway.listLockers).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(fakes.lockerGateway.getStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(plain(document.body.textContent)).toMatch(/Données actualisées à \d+ h \d{2}/))
  })

  it('polls the locker status on the interval of the Casiers page, and no other block', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fakes = gateways()
    renderWith(fakes)
    await waitFor(() => expect(fakes.lockerGateway.getStatus).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(LOCKER_STATUS_REFRESH_MS + 100)
    await waitFor(() => expect(fakes.lockerGateway.getStatus).toHaveBeenCalledTimes(2))
    expect(fakes.anomalyGateway.listAnomalies).toHaveBeenCalledTimes(1)
    expect(fakes.transactionGateway.listLoans).toHaveBeenCalledTimes(2)
  })
})

describe("Vue d'ensemble: the locker", () => {
  it('announces an offline locker in a persistent banner, and shows the cells as the last known state', async () => {
    renderWith(gateways({ status: ok(OFFLINE) }))
    const banner = await screen.findByText('Casier AEGIS-DEMO-01 hors ligne.')
    expect(banner.closest('[role="alert"]')).not.toBeNull()
    expect(plain(banner.closest('[role="alert"]')?.textContent)).toContain("Les valeurs des cellules sont les dernières connues, pas l'état actuel.")
    const locker = blockText('Casier')
    expect(locker).toContain('Hors ligne')
    expect(locker).toContain("Dernier état connu : le casier n'est pas en ligne, ces valeurs ne sont pas l'état actuel.")
  })

  it('does not suppose presence or absence for a locker whose state is unknown', async () => {
    renderWith(gateways({ status: ok(NEVER_SEEN) }))
    expect(await screen.findByText('Casier AEGIS-DEMO-01 : état inconnu.')).toBeDefined()
    expect(screen.getByText("Aucun signal valide n'a encore été reçu : aucune présence ni aucune absence n'est supposée.")).toBeDefined()
    expect(blockText('Casier')).toContain('Inconnue')
    expect(blockText('Casier')).toContain('Aucun signal reçu')
  })

  it('keeps the locker\'s own failure inside the locker block, naming the locker', async () => {
    renderWith(gateways({ status: problem(500, 'INTERNAL_ERROR', 'trace-status') }))
    await waitFor(() => expect(blockText('Casier')).toContain('trace-status'))
    expect(blockText('Casier')).toContain('AEGIS-DEMO-01')
    expect(blockText('Casier')).not.toContain('En ligne')
    expect(blockText('Anomalies ouvertes')).toContain('1 ouverte')
  })

  it('does not read a cell the list does not place as « no equipment placed »', async () => {
    renderWith(gateways({ lockers: ok(lockerPage([{ ...ADMIN_LOCKER, compartments: [ADMIN_LOCKER.compartments[0] as AdminLockerView['compartments'][number]] }])) }))
    await waitFor(() => expect(blockText('Casier')).toContain('Placement non lu'))
  })

  it('says so when no locker is registered, and when the locker list itself failed it is not « none »', async () => {
    renderWith(gateways({ lockers: ok(lockerPage([])) }))
    await waitFor(() => expect(blockText('Casier')).toContain('Aucun casier enregistré.'))
    cleanup()
    renderWith(gateways({ lockers: problem(500, 'INTERNAL_ERROR') }))
    await waitFor(() => expect(blockText('Casier')).toContain("Le service n'a pas pu fournir ces données."))
    expect(blockText('Casier')).not.toContain('Aucun casier enregistré.')
  })
})

describe("Vue d'ensemble: language and access", () => {
  it('is complete in English, with the same blocks and the English forms of the counts', async () => {
    renderWith(gateways({ loans: { ACTIVE: ok(pageOf([loan({ id: id(6), overdue: true })])), RETURN_PENDING: offline } }), { locale: 'en' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeDefined()
    expect(document.title).toBe('Overview — Aegis Manager')
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Open anomalies', 'Overdue loans', 'Locker', 'Operation in progress', 'Active reservations'])
    await waitFor(() => expect(blockText('Open anomalies')).toContain('1 open'))
    await waitFor(() => expect(blockText('Overdue loans')).toContain('1 overdue among the loans read'))
    expect(blockText('Overdue loans')).toContain('Incomplete read.')
    expect(blockText('Overdue loans')).toContain('Loans with the status Return in progress could not be read. The number shown covers only the loans read.')
    await waitFor(() => expect(blockText('Locker')).toContain('Online'))
    await waitFor(() => expect(blockText('Operation in progress')).toContain('1 observed in progress'))
    await waitFor(() => expect(blockText('Active reservations')).toContain('1 active'))
    expect(plain(document.querySelector('main')?.textContent)).toContain('Laboratory time: America/Toronto')
    expect(within(block('Open anomalies')).getByRole('link', { name: 'View anomalies' })).toBeDefined()
  })

  it('redirects to the sign-in page without an administrator session', async () => {
    window.history.replaceState(null, '', '/vue-d-ensemble')
    renderWithProviders(<App />, { gateway: authGateway, ...gateways() })
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
  })

  it('is the current section of the sidebar, a link like the others', async () => {
    renderWith()
    await screen.findByRole('heading', { level: 1, name: "Vue d'ensemble" })
    const sidebar = screen.getAllByRole('navigation', { name: 'Sections' })[0] as HTMLElement
    const current = within(sidebar).getAllByRole('link').find((link) => link.getAttribute('aria-current') === 'page')
    expect(current?.textContent).toBe("Vue d'ensemble")
    expect(current?.getAttribute('href')).toBe('/vue-d-ensemble')
  })
})
