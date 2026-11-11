import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway, type GatewayResult } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { CatalogGateway } from '../features/catalog/catalogGateway'
import { asset, fakeCatalogGateway, MM001, ok as catalogOk } from '../features/catalog/testFixtures'
import { parseLoanView, parseLockerOperationView, parseReservationView } from '../features/transactions/contractParsers'
import type { LoanView, LockerOperationView, ReservationView, TransactionPage } from '../features/transactions/contract'
import { unconfiguredTransactionGateway, type TransactionGateway } from '../features/transactions/transactionGateway'
import { ASSET_ID, LOAN_ID, OPERATION_ID, RESERVATION_ID, USER_ID, loanView, lockerOperationView, reservationView } from '../features/transactions/testFixtures'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

configure({ asyncUtilTimeout: 4000 })

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const ok = <T,>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-tx' })
const problem = (status: number, code: string, traceId = 'trace-0001') => ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId }), retryAfter: null, requestId: 'req-x' }) as const
const offline = { kind: 'network', reason: 'offline' } as const

const reservation = (overrides: Record<string, unknown> = {}): ReservationView => {
  const parsed = parseReservationView(reservationView(overrides))
  if (parsed === null) throw new Error('bad fixture')
  return parsed
}
const loan = (overrides: Record<string, unknown> = {}): LoanView => {
  const parsed = parseLoanView(loanView(overrides))
  if (parsed === null) throw new Error('bad fixture')
  return parsed
}
const operation = (overrides: Record<string, unknown> = {}): LockerOperationView => {
  const parsed = parseLockerOperationView(lockerOperationView(overrides))
  if (parsed === null) throw new Error('bad fixture')
  return parsed
}
const pageOf = <T,>(items: T[], overrides: Partial<TransactionPage<T>> = {}): TransactionPage<T> => ({
  items,
  page: 0,
  size: 20,
  totalItems: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...overrides,
})

const R1 = reservation()
const R2 = reservation({ id: 'aaaaaaaa-1111-4111-8111-111111111111', status: 'FULFILLED', fulfilledAt: '2026-11-10T14:06:00Z' })
const L1 = loan({ status: 'RETURN_PENDING', overdue: true, returnRequestedAt: '2026-11-10T21:40:00Z', currentOperationId: OPERATION_ID })
const L2 = loan({ id: 'bbbbbbbb-2222-4222-8222-222222222222', status: 'COMPLETED', overdue: true, returnedAt: '2026-11-10T20:00:00Z', returnOperationId: OPERATION_ID })

type Answer<T> = GatewayResult<T> | (() => Promise<GatewayResult<T>>)
const resolve = async <T,>(answer: Answer<T>): Promise<GatewayResult<T>> => (typeof answer === 'function' ? answer() : answer)

function fakeGateway({
  reservations = ok(pageOf([R1, R2])),
  loans = ok(pageOf([L1, L2])),
  operations = ok(pageOf([operation()])),
  details = {},
}: {
  reservations?: Answer<TransactionPage<ReservationView>>
  loans?: Answer<TransactionPage<LoanView>>
  operations?: Answer<TransactionPage<LockerOperationView>>
  details?: Record<string, Answer<ReservationView> | Answer<LoanView> | Answer<LockerOperationView>>
} = {}) {
  const detail = (items: { id: string }[]) => async (_token: string, id: string) => {
    const answer = details[id]
    if (answer !== undefined) return resolve(answer as Answer<never>)
    const found = items.find((item) => item.id === id)
    return found === undefined ? problem(404, 'RESOURCE_NOT_FOUND') : ok(found as never)
  }
  // A file is read by its id from what the list holds, like the real API would answer.
  const held = <T extends { id: string }>(answer: Answer<TransactionPage<T>>): T[] => (typeof answer !== 'function' && answer.kind === 'ok' ? [...answer.value.items] : [])
  const gateway = {
    listReservations: vi.fn(async () => resolve(reservations)),
    getReservation: vi.fn(detail(held(reservations))),
    listLoans: vi.fn(async () => resolve(loans)),
    getLoan: vi.fn(detail(held(loans))),
    listLockerOperations: vi.fn(async () => resolve(operations)),
    getLockerOperation: vi.fn(detail(held(operations))),
  }
  return gateway as unknown as TransactionGateway & typeof gateway
}

function renderPage(transactionGateway: TransactionGateway, { url = '/reservations-prets', locale = 'fr', catalogGateway }: { url?: string; locale?: Locale; catalogGateway?: CatalogGateway } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const catalog = catalogGateway ?? fakeCatalogGateway({ units: { [ASSET_ID]: catalogOk(asset({ id: ASSET_ID, assetCode: 'MM-001', placement: { lockerId: '3d4e5f60-7182-4a93-8ba4-c5d6e7f80912', lockerCode: 'AEGIS-DEMO-01', compartmentId: '4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b', compartmentCode: 'A1' } })) } })
  return renderWithProviders(<App />, { gateway: authGateway, transactionGateway, catalogGateway: catalog, session, queryClient, locale })
}

const rows = () => within(document.querySelector('.ag-list__items') as HTMLElement).getAllByRole('link')
const dossier = () => document.querySelector('.ag-dossier__scroll') as HTMLElement

beforeEach(() => {
  installMatchMedia(window, false)
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('Réservations et prêts: reservations', () => {
  it('lists the reservations, reads the first one by its id and shows the holder as an identifier only', async () => {
    const gateway = fakeGateway()
    renderPage(gateway)
    expect(await screen.findByRole('heading', { level: 2, name: '2 réservations' })).toBeDefined()
    expect(document.title).toBe('Réservations et prêts — Aegis Manager')
    expect(rows()).toHaveLength(2)
    expect(rows()[0]?.getAttribute('aria-current')).toBe('true')
    await waitFor(() => expect(gateway.getReservation).toHaveBeenCalledTimes(1))
    expect(gateway.getReservation.mock.calls[0]?.[1]).toBe(RESERVATION_ID)
    expect(gateway.getReservation.mock.calls[0]?.[0]).toBe('token-value')
    const text = plain(dossier().textContent)
    expect(text).toContain('Titulaire')
    expect(text).toContain('Identifiant seulement')
    expect(text).toContain(USER_ID)
    expect(text).toContain("Une réservation n'ouvre aucune porte et ne crée aucun prêt.")
    // The server's order is not promised, and no sort is ever sent.
    expect(plain(document.querySelector('.ag-list__foot')?.textContent)).toContain("Dans l'ordre fourni par le serveur")
    const query = gateway.listReservations.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(query[1]).toEqual({ page: 0, size: 20 })
    expect(query[1]).not.toHaveProperty('sort')
  })

  it('offers no action that changes custody and never shows availableActions', async () => {
    renderPage(fakeGateway({ reservations: ok(pageOf([reservation({ availableActions: ['CANCEL_RESERVATION'] })])) }))
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    await waitFor(() => expect(dossier()).toBeDefined())
    const main = document.querySelector('main') as HTMLElement
    const buttons = within(main).queryAllByRole('button').map((button) => plain(button.textContent))
    expect(buttons.join('|')).not.toMatch(/terminer|confirmer|forcer|ouvrir|résoudre|annuler|supprimer/i)
    expect(plain(main.textContent)).not.toMatch(/CANCEL_RESERVATION|Annuler la réservation/)
  })

  it('selects another reservation by link and keeps the address: view, page and file', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway()
    renderPage(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    await user.click(rows()[1] as HTMLElement)
    expect(window.location.search).toBe(`?dossier=${R2.id}`)
    await waitFor(() => expect(gateway.getReservation.mock.calls.map((call) => call[1])).toContain(R2.id))
    expect(rows()[1]?.getAttribute('aria-current')).toBe('true')
    // Side by side, focus stays on the row and a live region says what changed.
    expect(document.activeElement).toBe(rows()[1])
    expect([...document.querySelectorAll('[role="status"]')].map((region) => region.textContent).join('|')).toContain('Dossier sélectionné')
  })

  it('restores the selection with the back button', async () => {
    const user = userEvent.setup()
    renderPage(fakeGateway())
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    await user.click(rows()[1] as HTMLElement)
    expect(rows()[1]?.getAttribute('aria-current')).toBe('true')
    window.history.back()
    await waitFor(() => expect(rows()[0]?.getAttribute('aria-current')).toBe('true'))
  })

  it('moves focus to the dossier after a selection on a stacked layout', async () => {
    installMatchMedia(window, true)
    const user = userEvent.setup()
    renderPage(fakeGateway())
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    await user.click(rows()[1] as HTMLElement)
    await waitFor(() => expect(document.activeElement).toBe(dossier()))
    expect(dossier().getAttribute('tabindex')).toBe('0')
  })

  it('reads a direct address (view, filters, page, file) and sends exactly those filters', async () => {
    const gateway = fakeGateway({ reservations: ok(pageOf([R1, R2], { page: 1, totalItems: 22, totalPages: 2 })) })
    renderPage(gateway, { url: `/reservations-prets?statut=ACTIVE&equipement=${ASSET_ID.toUpperCase()}&du=2026-11-01&au=2026-11-10&page=2&dossier=${R2.id}` })
    await screen.findByRole('heading', { level: 2, name: '22 réservations' })
    const sent = (gateway.listReservations.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    // « Du » starts at midnight of the laboratory day (still EDT on 1 November); « Au » is inclusive, so the bound sent
    // is the start of the next laboratory day (EST on 11 November). `to` is exclusive in the API.
    expect(sent).toEqual({ status: 'ACTIVE', assetId: ASSET_ID, from: '2026-11-01T04:00:00Z', to: '2026-11-11T05:00:00Z', page: 1, size: 20 })
    await waitFor(() => expect(gateway.getReservation.mock.calls[0]?.[1]).toBe(R2.id))
    expect(screen.getByRole('heading', { level: 2, name: /Multimètre/ })).toBeDefined()
    expect(screen.getByText('Page 2 sur 2')).toBeDefined()
  })

  it('ignores unusable address values and never sends them', async () => {
    const gateway = fakeGateway()
    renderPage(gateway, { url: '/reservations-prets?statut=PAUSED&equipement=abc&du=2026-02-30&page=-3&dossier=x' })
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    expect((gateway.listReservations.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toEqual({ page: 0, size: 20 })
  })

  it('paginates with the server envelope and keeps the filters', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway({ reservations: ok(pageOf([R1, R2], { totalItems: 30, totalPages: 2 })) })
    renderPage(gateway, { url: '/reservations-prets?statut=ACTIVE' })
    await screen.findByRole('heading', { level: 2, name: '30 réservations' })
    const pager = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(pager).getByRole('button', { name: 'Précédent' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(within(pager).getByRole('button', { name: 'Suivant' }))
    expect(window.location.search).toBe('?statut=ACTIVE&page=2')
    await waitFor(() => expect(gateway.listReservations).toHaveBeenCalledTimes(2))
    expect((gateway.listReservations.mock.calls[1] as unknown as [string, Record<string, unknown>])[1]).toMatchObject({ status: 'ACTIVE', page: 1 })
  })
})

describe('Réservations et prêts: filters', () => {
  it('applies the filters to the address and to the request, and clears them', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway()
    renderPage(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    await user.selectOptions(screen.getByLabelText('Statut'), 'FULFILLED')
    await user.type(screen.getByLabelText('Équipement (identifiant)'), ` ${ASSET_ID} `)
    await user.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(window.location.search).toBe(`?statut=FULFILLED&equipement=${ASSET_ID}`)
    await waitFor(() => expect(gateway.listReservations).toHaveBeenCalledTimes(2))
    expect((gateway.listReservations.mock.calls[1] as unknown as [string, Record<string, unknown>])[1]).toMatchObject({ status: 'FULFILLED', assetId: ASSET_ID })
    await user.click(screen.getByRole('button', { name: 'Tout afficher' }))
    expect(window.location.search).toBe('')
  })

  it('refuses an equipment id that is not a UUID, names the field and sends nothing', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway()
    renderPage(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    const field = screen.getByLabelText('Équipement (identifiant)')
    await user.type(field, 'MM-001')
    await user.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText("L'identifiant d'équipement doit être un UUID complet.")).toBeDefined()
    expect(document.activeElement).toBe(field)
    expect(gateway.listReservations).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('')
  })

  it('refuses an end date before the start date', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway()
    renderPage(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    await user.type(screen.getByLabelText('Du'), '2026-11-10')
    await user.type(screen.getByLabelText('Au'), '2026-11-01')
    await user.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(screen.getByText('La date de fin précède la date de début.')).toBeDefined()
    expect(gateway.listReservations).toHaveBeenCalledTimes(1)
  })

  it('offers the statuses of the active view only', async () => {
    renderPage(fakeGateway(), { url: '/reservations-prets?vue=prets' })
    await screen.findByRole('heading', { level: 2, name: '4 prêts'.replace('4', '2') })
    const options = within(screen.getByLabelText('Statut')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Tous', 'Actif', 'Retour en cours', 'Terminé'])
  })

  it('says so when a filter matches nothing, with a way back, and never claims there is no record', async () => {
    const user = userEvent.setup()
    renderPage(fakeGateway({ reservations: ok(pageOf([])) }), { url: '/reservations-prets?statut=CANCELLED' })
    expect(await screen.findByText('Aucune réservation ne correspond à ces filtres.')).toBeDefined()
    expect(screen.queryByText('Aucune réservation.')).toBeNull()
    expect(document.querySelector('.ag-dossier')).toBeNull()
    const clear = within(document.querySelector('.ag-list__empty') as HTMLElement).getByRole('button', { name: 'Tout afficher' })
    await user.click(clear)
    expect(window.location.search).toBe('')
  })

  it('says there is nothing yet when the unfiltered list is empty', async () => {
    renderPage(fakeGateway({ reservations: ok(pageOf([])) }))
    expect(await screen.findByText('Aucune réservation.')).toBeDefined()
    expect(screen.getByText('Les réservations apparaissent ici dès leur création.')).toBeDefined()
  })
})

describe('Réservations et prêts: loans', () => {
  it('keeps an overdue loan borrowed: status, overdue mention, never available', async () => {
    renderPage(fakeGateway(), { url: '/reservations-prets?vue=prets' })
    await screen.findByRole('heading', { level: 2, name: '2 prêts' })
    const first = rows()[0] as HTMLElement
    expect(plain(first.textContent)).toContain('Retour en cours')
    expect(plain(first.textContent)).toContain('En retard')
    expect(plain(first.textContent)).toMatch(/En retard depuis/)
    await waitFor(() => expect(plain(dossier().textContent)).toContain("l'équipement reste emprunté"))
    const main = plain(document.querySelector('main')?.textContent)
    expect(main).toContain('Titulaire')
    expect(main).not.toMatch(/Disponible|Prêt à/)
  })

  it('does not call a completed loan overdue, whatever the flag says', async () => {
    renderPage(fakeGateway(), { url: `/reservations-prets?vue=prets&dossier=${L2.id}` })
    await screen.findByRole('heading', { level: 2, name: '2 prêts' })
    const second = rows()[1] as HTMLElement
    expect(plain(second.textContent)).toContain('Terminé')
    expect(plain(second.textContent)).not.toContain('En retard')
    await waitFor(() => expect(dossier()).toBeDefined())
    expect(plain(dossier().textContent)).not.toContain('En retard depuis')
  })

  it('links the checkout and the current operation of a loan to their file', async () => {
    renderPage(fakeGateway(), { url: `/reservations-prets?vue=prets&dossier=${L1.id}` })
    await screen.findByRole('heading', { level: 2, name: '2 prêts' })
    await waitFor(() => expect(within(dossier()).getAllByRole('link', { name: "Ouvrir l'opération" }).length).toBeGreaterThan(0))
    const hrefs = within(dossier()).getAllByRole('link', { name: "Ouvrir l'opération" }).map((link) => link.getAttribute('href'))
    expect(hrefs).toContain(`/reservations-prets?vue=operations&dossier=${OPERATION_ID}`)
    expect(LOAN_ID).toBeTruthy()
  })
})

describe('Réservations et prêts: locker operations', () => {
  it('shows only the instants the server sent and says a missing step was not received', async () => {
    const op = operation({ status: 'COMMAND_ACKNOWLEDGED', doorOpenedAt: null, observationReceivedAt: null, confirmedAt: null, terminalAt: null, requiredAction: 'WAIT' })
    renderPage(fakeGateway({ operations: ok(pageOf([op])) }), { url: '/reservations-prets?vue=operations' })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Commande acquittée par la cellule'))
    const text = plain(dossier().textContent)
    expect(text).toContain('Porte ouverte observée')
    expect(text).toContain('Pas encore reçue')
    expect(text).toContain("Un accusé de commande ne prouve ni le déverrouillage ni l'ouverture.")
    // A step without an instant is never filled in from a later one, and the challenge steps do not apply.
    expect(text).toContain('Code affiché sur le casier · Sans objet')
    expect(text).not.toContain('déverrouillée')
  })

  it('calls a missing step of a terminal operation « Non reçue »', async () => {
    const op = operation({ status: 'ANOMALY', confirmedAt: null, observationReceivedAt: null, anomalyId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' })
    renderPage(fakeGateway({ operations: ok(pageOf([op])) }), { url: '/reservations-prets?vue=operations' })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Non reçue'))
    expect(plain(dossier().textContent)).toContain('Anomalie constatée')
    expect(plain(dossier().textContent)).toContain('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d')
  })

  it('resolves the equipment and the cell from the catalog and falls back to identifiers when that read fails', async () => {
    const ok1 = renderPage(fakeGateway(), { url: '/reservations-prets?vue=operations' })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('A1'))
    expect(plain(dossier().textContent)).toContain('AEGIS-DEMO-01')
    ok1.unmount()

    const failing = fakeCatalogGateway({ units: { [MM001.id]: catalogOk(MM001), [ASSET_ID]: problem(500, 'INTERNAL_ERROR') as never } })
    renderPage(fakeGateway(), { url: '/reservations-prets?vue=operations', catalogGateway: failing })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    expect(await screen.findByText('Libellés non résolus.')).toBeDefined()
    expect(plain(dossier().textContent)).toContain('Cellule : identifiant seulement')
    expect(plain(dossier().textContent)).toContain(OPERATION_ID)
  })

  it('shows an unknown status as not recognized, never as a known state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const op = operation({ status: 'PAUSED' })
    renderPage(fakeGateway({ operations: ok(pageOf([op])) }), { url: '/reservations-prets?vue=operations' })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    expect(plain(rows()[0]?.textContent)).toContain('Non reconnu par cette version')
  })

  it('asks the operations list with the equipment filter when linked from a reservation', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway({ reservations: ok(pageOf([R2])) })
    renderPage(gateway, { url: `/reservations-prets?dossier=${R2.id}` })
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    const link = await screen.findByRole('link', { name: 'Voir les opérations de cet équipement' })
    expect(plain(dossier().textContent)).toContain("Aucun prêt n'est déduit d'une réservation.")
    await user.click(link)
    expect(window.location.search).toBe(`?vue=operations&equipement=${ASSET_ID}`)
    await waitFor(() => expect(gateway.listLockerOperations).toHaveBeenCalled())
    expect((gateway.listLockerOperations.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toMatchObject({ assetId: ASSET_ID })
  })
})

describe('Réservations et prêts: failures', () => {
  it('shows a service error with its trace id and a retry, not an empty list', async () => {
    const user = userEvent.setup()
    const gateway = fakeGateway({ reservations: problem(500, 'INTERNAL_ERROR', 'trace-svc-1') })
    renderPage(gateway)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Le service n'a pas pu fournir ces données.")).toBeDefined()
    expect(within(alert).getByText('trace-svc-1')).toBeDefined()
    expect(screen.queryByText('Aucune réservation.')).toBeNull()
    expect(document.querySelector('.ag-dossier')).toBeNull()
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(gateway.listReservations).toHaveBeenCalledTimes(2))
  })

  it('reads a 404 of a list as a service error with its trace id, never as empty or not yet available', async () => {
    renderPage(fakeGateway({ loans: problem(404, 'RESOURCE_NOT_FOUND', 'trace-404-list') }), { url: '/reservations-prets?vue=prets' })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Le service n'a pas pu fournir ces données.")).toBeDefined()
    expect(within(alert).getByText('trace-404-list')).toBeDefined()
    const text = plain(document.querySelector('main')?.textContent)
    expect(text).not.toMatch(/Aucun prêt|0 prêt|bientôt|pas encore disponible|Dossier introuvable/)
  })

  it('reports a forbidden account with no data and no retry', async () => {
    renderPage(fakeGateway({ reservations: problem(403, 'FORBIDDEN') }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Votre compte n'a pas accès aux réservations et aux prêts.")).toBeDefined()
    expect(within(alert).queryByRole('button')).toBeNull()
  })

  it('reports an unreachable service as a warning without a trace id', async () => {
    renderPage(fakeGateway({ reservations: offline }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Connexion au service impossible.')).toBeDefined()
    expect(alert.querySelector('code')).toBeNull()
  })

  it('returns to sign-in on a 401 and shows no data', async () => {
    renderPage(fakeGateway({ reservations: problem(401, 'AUTH_TOKEN_EXPIRED') }))
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(screen.queryByText('2 réservations')).toBeNull()
  })

  it('shows « Dossier introuvable » for a missing file and keeps the list usable', async () => {
    const user = userEvent.setup()
    const missing = 'cccccccc-3333-4333-8333-333333333333'
    renderPage(fakeGateway(), { url: `/reservations-prets?dossier=${missing}` })
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    expect(await screen.findByText('Dossier introuvable.')).toBeDefined()
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Retour à la liste' }))
    expect(window.location.search).toBe('')
  })

  it('keeps the data and says it is not up to date when a refresh fails', async () => {
    const user = userEvent.setup()
    let fail = false
    const gateway = fakeGateway({ reservations: async () => (fail ? problem(500, 'INTERNAL_ERROR') : ok(pageOf([R1, R2]))) })
    renderPage(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    fail = true
    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    expect(await screen.findByText('Données non actualisées.')).toBeDefined()
    expect(rows()).toHaveLength(2)
  })

  it('shows loading placeholders and announces the load, without a count', async () => {
    let release: (value: GatewayResult<TransactionPage<ReservationView>>) => void = () => {}
    const gateway = fakeGateway({ reservations: () => new Promise((resolveList) => (release = resolveList)) })
    renderPage(gateway)
    const list = (await screen.findByRole('heading', { level: 2, name: 'Réservations' })).closest('section') as HTMLElement
    expect(list.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('.ag-skel')).not.toBeNull()
    release(ok(pageOf([R1])))
    expect(await screen.findByRole('heading', { level: 2, name: '1 réservation' })).toBeDefined()
  })
})

describe('Réservations et prêts: navigation, keyboard and language', () => {
  it('moves between the three views with real links and marks the current one', async () => {
    const user = userEvent.setup()
    renderPage(fakeGateway())
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    const tabs = screen.getByRole('navigation', { name: 'Vues' })
    expect(within(tabs).getByRole('link', { name: 'Réservations' }).getAttribute('aria-current')).toBe('page')
    await user.click(within(tabs).getByRole('link', { name: 'Opérations physiques' }))
    expect(window.location.search).toBe('?vue=operations')
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    expect(within(tabs).getByRole('link', { name: 'Opérations physiques' }).getAttribute('aria-current')).toBe('page')
  })

  it('is reachable from the sidebar and starts keyboard order with the skip link, then the page', async () => {
    const user = userEvent.setup()
    renderPage(fakeGateway(), { url: '/equipements' })
    const sidebar = screen.getAllByRole('navigation', { name: 'Sections' })[0] as HTMLElement
    await user.click(within(sidebar).getByRole('link', { name: 'Réservations et prêts' }))
    expect(window.location.pathname).toBe('/reservations-prets')
    await screen.findByRole('heading', { level: 1, name: 'Réservations et prêts' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('has a scrolling dossier that the keyboard can reach and fields with visible labels', async () => {
    renderPage(fakeGateway())
    await screen.findByRole('heading', { level: 2, name: '2 réservations' })
    await waitFor(() => expect(dossier()).not.toBeNull())
    expect(dossier().getAttribute('role')).toBe('group')
    expect(dossier().getAttribute('aria-labelledby')).toBeTruthy()
    for (const label of ['Statut', 'Équipement (identifiant)', 'Du', 'Au']) expect(screen.getByLabelText(label)).toBeDefined()
  })

  it('is fully translated in English, with the same structure and no French left', async () => {
    renderPage(fakeGateway(), { locale: 'en', url: '/reservations-prets?vue=prets' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Reservations and loans' })).toBeDefined()
    expect(await screen.findByRole('heading', { level: 2, name: '2 loans' })).toBeDefined()
    expect(document.title).toBe('Reservations and loans — Aegis Manager')
    await waitFor(() => expect(plain(dossier().textContent)).toContain('the equipment stays borrowed'))
    const text = plain(document.querySelector('main')?.textContent)
    expect(text).toContain('Holder')
    expect(text).toContain('Overdue')
    expect(text).not.toMatch(/Titulaire|Prêt|Réservation|Chronologie|retard/)
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeDefined()
  })
})

// The unconfigured gateway fails as unreachable: the page then says so instead of showing an empty list.
describe('without a configured gateway', () => {
  it('reports the service as unreachable', async () => {
    renderPage(unconfiguredTransactionGateway)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Connexion au service impossible.')).toBeDefined()
  })
})
