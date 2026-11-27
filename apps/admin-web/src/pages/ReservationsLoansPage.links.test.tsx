import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import type { AnomalyGateway } from '../features/anomalies/anomalyGateway'
import { ANOMALY_ID as ANOMALY, fakeAnomalyGateway, ok as anomalyOk, parsedDetail } from '../features/anomalies/testFixtures'
import { unconfiguredAuthGateway, type AuthGateway, type GatewayResult } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody, sessionStubs } from '../features/auth/testFixtures'
import { asset, fakeCatalogGateway, ok as catalogOk } from '../features/catalog/testFixtures'
import { parseLoanView, parseLockerOperationView, parseReservationView } from '../features/transactions/contractParsers'
import type { LoanView, LockerOperationView, ReservationView, TransactionPage } from '../features/transactions/contract'
import { ASSET_ID, LOAN_ID, LOCKER_ID, OPERATION_ID, RESERVATION_ID, loanView, lockerOperationView, reservationView } from '../features/transactions/testFixtures'
import type { TransactionGateway } from '../features/transactions/transactionGateway'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

configure({ asyncUtilTimeout: 4000 })

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, ...sessionStubs, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const ok = <T,>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-tx' })
const problem = (status: number, code: string) => ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId: 'trace-0001' }), retryAfter: null, requestId: 'req-x' }) as const

const parsed = <T,>(value: T | null): T => {
  if (value === null) throw new Error('bad fixture')
  return value
}
const reservation = (overrides: Record<string, unknown> = {}): ReservationView => parsed(parseReservationView(reservationView(overrides)))
const loan = (overrides: Record<string, unknown> = {}): LoanView => parsed(parseLoanView(loanView(overrides)))
const operation = (overrides: Record<string, unknown> = {}): LockerOperationView => parsed(parseLockerOperationView(lockerOperationView(overrides)))
const pageOf = <T,>(items: T[]): TransactionPage<T> => ({ items, page: 0, size: 20, totalItems: items.length, totalPages: items.length === 0 ? 0 : 1 })

const ATTEMPT_ID = 'aaaaaaaa-0000-4000-8000-00000000a001'

function fakeGateway({
  reservations = [reservation()],
  loans = [loan()],
  operations = [operation()],
  attempts = {},
}: {
  reservations?: ReservationView[]
  loans?: LoanView[]
  operations?: LockerOperationView[]
  /** Answers of `getLockerOperation` by id, over what the list holds. */
  attempts?: Record<string, GatewayResult<LockerOperationView>>
} = {}) {
  const find = <T extends { id: string }>(items: T[], id: string) => {
    const found = items.find((item) => item.id === id)
    return found === undefined ? problem(404, 'RESOURCE_NOT_FOUND') : ok(found)
  }
  const gateway = {
    listReservations: vi.fn(async () => ok(pageOf(reservations))),
    getReservation: vi.fn(async (_token: string, id: string) => find(reservations, id)),
    listLoans: vi.fn(async () => ok(pageOf(loans))),
    getLoan: vi.fn(async (_token: string, id: string) => find(loans, id)),
    listLockerOperations: vi.fn(async () => ok(pageOf(operations))),
    getLockerOperation: vi.fn(async (_token: string, id: string) => attempts[id] ?? find(operations, id)),
  }
  return gateway as unknown as TransactionGateway & typeof gateway
}

function renderPage(transactionGateway: TransactionGateway, { url, locale = 'fr', anomalyGateway }: { url: string; locale?: Locale; anomalyGateway?: AnomalyGateway }) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const catalog = fakeCatalogGateway({ units: { [ASSET_ID]: catalogOk(asset({ id: ASSET_ID, assetCode: 'MM-001' })) } })
  return renderWithProviders(<App />, { gateway: authGateway, transactionGateway, catalogGateway: catalog, anomalyGateway, session, queryClient, locale })
}

const dossier = () => document.querySelector('.ag-dossier__scroll') as HTMLElement
/** What the eye reads: the screen-reader-only full identifiers left out (§1.8 criterion 1). */
const visible = (element: Element): string => {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('.ag-sr-only').forEach((node) => node.remove())
  return plain(copy.textContent)
}
const hrefOf = (name: string | RegExp) => within(dossier()).getByRole('link', { name }).getAttribute('href')

beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('R2: links between dossiers', () => {
  it('links an operation to its anomaly and to its audit, and shows the anomaly status the server read', async () => {
    const anomalies = fakeAnomalyGateway({ getAnomaly: async () => anomalyOk(parsedDetail({ status: 'ACKNOWLEDGED', acknowledgedAt: '2026-11-10T19:10:00Z' })) })
    renderPage(fakeGateway({ operations: [operation({ status: 'ANOMALY', anomalyId: ANOMALY })] }), { url: '/reservations-prets?vue=operations', anomalyGateway: anomalies })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    await waitFor(() => expect(within(dossier()).getByRole('link', { name: "Ouvrir l'anomalie" })).toBeDefined())
    expect(hrefOf("Ouvrir l'anomalie")).toBe(`/anomalies?anomalie=${ANOMALY}`)
    expect(hrefOf('Audit de cette opération')).toBe(`/audit?operation=${OPERATION_ID}`)
    // The anomaly's own status, in its own words: never « Commande acquittée », never « résolue ».
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Reconnue : la vérification est engagée'))
    expect(plain(dossier().textContent)).not.toContain('Résolue')
    // §1.8 criterion 1: the linked anomaly shows its abbreviated identifier, never the full one.
    expect(visible(dossier())).toContain(`${ANOMALY.slice(0, 8)}…`)
    expect(visible(dossier())).not.toContain(ANOMALY)
  })

  it('says an anomaly is resolved only when the anomaly itself says so', async () => {
    const anomalies = fakeAnomalyGateway({ getAnomaly: async () => anomalyOk(parsedDetail({ status: 'RESOLVED', resolvedAt: '2026-11-10T20:00:00Z', acknowledgedAt: '2026-11-10T19:10:00Z' })) })
    renderPage(fakeGateway({ operations: [operation({ status: 'ANOMALY', anomalyId: ANOMALY })] }), { url: '/reservations-prets?vue=operations', anomalyGateway: anomalies })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('par une nouvelle observation du casier'))
  })

  it('keeps the plain anomaly link when the anomaly cannot be read, and links the audit of an operation without anomaly', async () => {
    const anomalies = fakeAnomalyGateway({ getAnomaly: async () => problem(500, 'INTERNAL_ERROR') })
    const view = renderPage(fakeGateway({ operations: [operation({ status: 'ANOMALY', anomalyId: ANOMALY })] }), { url: '/reservations-prets?vue=operations', anomalyGateway: anomalies })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    expect(hrefOf("Ouvrir l'anomalie")).toBe(`/anomalies?anomalie=${ANOMALY}`)
    expect(plain(dossier().textContent)).not.toContain('Reconnue')
    view.unmount()
    renderPage(fakeGateway(), { url: '/reservations-prets?vue=operations' })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    expect(within(dossier()).queryByRole('link', { name: "Ouvrir l'anomalie" })).toBeNull()
    expect(plain(dossier().textContent)).toContain('Aucune anomalie liée')
    expect(hrefOf('Audit de cette opération')).toBe(`/audit?operation=${OPERATION_ID}`)
  })

  it('links a fulfilled reservation to the loans of its equipment, without inferring a loan', async () => {
    renderPage(fakeGateway({ reservations: [reservation({ status: 'FULFILLED', fulfilledAt: '2026-11-10T14:06:00Z' })] }), { url: '/reservations-prets' })
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    expect(hrefOf('Voir les prêts de cet équipement')).toBe(`/reservations-prets?vue=prets&equipement=${ASSET_ID}`)
    expect(hrefOf('Voir les opérations de cet équipement')).toBe(`/reservations-prets?vue=operations&equipement=${ASSET_ID}`)
    expect(plain(dossier().textContent)).toContain("Aucun prêt n'est déduit d'une réservation.")
  })

  it('offers no loans link on a reservation that is not fulfilled', async () => {
    renderPage(fakeGateway(), { url: '/reservations-prets' })
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    expect(within(dossier()).queryByRole('link', { name: 'Voir les prêts de cet équipement' })).toBeNull()
  })
})

describe('R3: the locker filter of the operations', () => {
  it('sends the lockerId, shows the filter and lets the administrator remove it', async () => {
    const gateway = fakeGateway()
    renderPage(gateway, { url: `/reservations-prets?vue=operations&casier=${LOCKER_ID}` })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    expect(gateway.listLockerOperations.mock.calls[0]).toEqual(['token-value', { lockerId: LOCKER_ID, page: 0, size: 20 }, expect.anything()])
    const chip = screen.getByTestId('locker-filter')
    // The locker is not in the label index here: its abbreviated identifier, the full one for assistive technologies only.
    expect(visible(chip)).toContain(`Casier filtré : ${LOCKER_ID.slice(0, 8)}…`)
    expect(visible(chip)).not.toContain(LOCKER_ID)
    expect(plain(chip.textContent)).toContain(LOCKER_ID)
    expect(within(chip).getByRole('link', { name: 'Retirer ce filtre' }).getAttribute('href')).toBe('/reservations-prets?vue=operations')
  })

  it('keeps the locker when the other filters are applied, and drops it with « Effacer les filtres »', async () => {
    const gateway = fakeGateway()
    renderPage(gateway, { url: `/reservations-prets?vue=operations&casier=${LOCKER_ID}` })
    await screen.findByRole('heading', { level: 2, name: '1 opération' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Statut' }), 'CONFIRMED')
    await waitFor(() => expect(window.location.search).toBe(`?vue=operations&statut=CONFIRMED&casier=${LOCKER_ID}`))
    await userEvent.click(screen.getByRole('button', { name: 'Effacer les filtres' }))
    await waitFor(() => expect(window.location.search).toBe('?vue=operations'))
    expect(screen.queryByTestId('locker-filter')).toBeNull()
  })

  it('does not send the locker to reservations and loans', async () => {
    const gateway = fakeGateway()
    renderPage(gateway, { url: `/reservations-prets?vue=prets&casier=${LOCKER_ID}` })
    await screen.findByRole('heading', { level: 2, name: '1 prêt' })
    // The navigation badge reads the open loans by status, size 100 (contract §1.6); the page's own read is the other one.
    expect((gateway.listLoans.mock.calls as unknown[][]).map((call) => call[1]).filter((query) => (query as { size?: number }).size !== 100)[0]).toEqual({ page: 0, size: 20 })
    expect(screen.queryByTestId('locker-filter')).toBeNull()
  })
})

describe('R4: the current attempt of a reservation or a loan', () => {
  const attempt = (overrides: Record<string, unknown> = {}) => operation({ id: ATTEMPT_ID, reservationId: RESERVATION_ID, loanId: null, ...overrides })

  it('explains an active reservation whose attempt is acknowledged, from the attempt status and not from the clock', async () => {
    const acknowledged = attempt({ status: 'COMMAND_ACKNOWLEDGED', doorOpenedAt: null, observationReceivedAt: null, confirmedAt: null, terminalAt: null })
    const gateway = fakeGateway({ reservations: [reservation({ reservedUntil: '2020-01-01T00:00:00Z', currentOperationId: ATTEMPT_ID })], operations: [acknowledged] })
    renderPage(gateway, { url: '/reservations-prets' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Commande acquittée'))
    const text = plain(dossier().textContent)
    expect(text).toContain("Tentative en cours : le serveur n'a pas encore décidé de son issue.")
    expect(text).toContain("Ce n'est pas une confirmation physique.")
    expect(text).toContain("La confirmation physique est une décision du serveur ; elle n'est pas encore rendue.")
    expect(text).toContain("La période réservée est passée, mais la réservation reste active tant que le serveur n'a pas établi l'issue physique de cette tentative")
    expect(gateway.getLockerOperation.mock.calls.map((call) => call[1])).toEqual([ATTEMPT_ID])
    expect(hrefOf("Ouvrir l'opération")).toBe(`/reservations-prets?vue=operations&dossier=${ATTEMPT_ID}`)
  })

  it('reads the attempt once and never follows it from a reservation dossier', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const gateway = fakeGateway({ reservations: [reservation({ currentOperationId: ATTEMPT_ID })], operations: [attempt({ status: 'AUTHORIZED', terminalAt: null, confirmedAt: null })] })
      renderPage(gateway, { url: '/reservations-prets' })
      await waitFor(() => expect(plain(dossier().textContent)).toContain('Accès autorisé'))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(gateway.getLockerOperation).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a confirmed attempt as a decision of the server, and adds no deferred-expiry text for a terminal attempt', async () => {
    renderPage(fakeGateway({ reservations: [reservation({ currentOperationId: ATTEMPT_ID })], operations: [attempt({ status: 'CONFIRMED' })] }), { url: '/reservations-prets' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Confirmation physique : décision du serveur'))
    expect(plain(dossier().textContent)).not.toContain('reste active')
  })

  it.each(['REQUESTED', 'AWAITING_LOCAL_PROOF'])('never says the expiry is deferred during the QR wait (%s), even past due (06 §14.1)', async (status) => {
    const waiting = attempt({ status, doorOpenedAt: null, observationReceivedAt: null, confirmedAt: null, terminalAt: null, commandSentAt: null, commandAcknowledgedAt: null })
    renderPage(fakeGateway({ reservations: [reservation({ reservedUntil: '2020-01-01T00:00:00Z', currentOperationId: ATTEMPT_ID })], operations: [waiting] }), { url: '/reservations-prets' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Tentative en cours'))
    expect(plain(dossier().textContent)).not.toContain('expiration est différée')
  })

  it('does not say the expiry is deferred before the end of the reserved period', async () => {
    const authorized = attempt({ status: 'AUTHORIZED', terminalAt: null, confirmedAt: null })
    renderPage(fakeGateway({ reservations: [reservation({ reservedUntil: '2999-01-01T00:00:00Z', currentOperationId: ATTEMPT_ID })], operations: [authorized] }), { url: '/reservations-prets' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Accès autorisé'))
    expect(plain(dossier().textContent)).not.toContain('expiration est différée')
  })

  it('keeps the hollow end marker of an active reservation past its end: the marker follows the server status, not a clock (§1.7)', async () => {
    renderPage(fakeGateway({ reservations: [reservation({ reservedUntil: '2020-01-01T00:00:00Z' })] }), { url: '/reservations-prets' })
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    await waitFor(() => expect(dossier()?.querySelector('.ag-tl')).not.toBeNull())
    expect(dossier().querySelector('.ag-tl__item--marker')).toBeNull()
  })

  it('says the expiry is deferred for a physically uncertain attempt (ANOMALY) on an active reservation past due', async () => {
    const anomalies = fakeAnomalyGateway({ getAnomaly: async () => anomalyOk(parsedDetail({ status: 'OPEN' })) })
    renderPage(fakeGateway({ reservations: [reservation({ reservedUntil: '2020-01-01T00:00:00Z', currentOperationId: ATTEMPT_ID })], operations: [attempt({ status: 'ANOMALY', anomalyId: ANOMALY })] }), { url: '/reservations-prets', anomalyGateway: anomalies })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Anomalie constatée sur cette tentative'))
    expect(plain(dossier().textContent)).toContain('son expiration est différée')
  })

  it('shows a failed attempt as no physical confirmation', async () => {
    renderPage(fakeGateway({ reservations: [reservation({ currentOperationId: ATTEMPT_ID })], operations: [attempt({ status: 'FAILED', failureReason: 'COMMAND_REJECTED' })] }), { url: '/reservations-prets' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Tentative en échec : aucune confirmation physique.'))
    expect(plain(dossier().textContent)).not.toContain('Confirmation physique :')
  })

  it('shows the attempt of a loan, with the anomaly status apart from the command acknowledgement', async () => {
    const anomalies = fakeAnomalyGateway({ getAnomaly: async () => anomalyOk(parsedDetail({ status: 'OPEN' })) })
    renderPage(fakeGateway({ loans: [loan({ currentOperationId: ATTEMPT_ID })], operations: [attempt({ type: 'RETURN', status: 'ANOMALY', loanId: LOAN_ID, anomalyId: ANOMALY })] }), { url: '/reservations-prets?vue=prets', anomalyGateway: anomalies })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Anomalie constatée sur cette tentative'))
    await waitFor(() => expect(plain(dossier().textContent)).toContain("Cette anomalie n’a pas encore été reconnue."))
    expect(plain(dossier().textContent)).not.toContain('reste active')
    expect(hrefOf("Ouvrir l'anomalie")).toBe(`/anomalies?anomalie=${ANOMALY}`)
  })

  it('falls back on the link when the attempt cannot be read, and adds nothing without an attempt', async () => {
    const gateway = fakeGateway({ reservations: [reservation({ currentOperationId: ATTEMPT_ID })], attempts: { [ATTEMPT_ID]: problem(500, 'INTERNAL_ERROR') as never } })
    const view = renderPage(gateway, { url: '/reservations-prets' })
    await waitFor(() => expect(gateway.getLockerOperation).toHaveBeenCalled())
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    await waitFor(() => expect(plain(dossier().textContent)).not.toContain('Lecture de la tentative'))
    expect(plain(dossier().textContent)).not.toContain("État de la tentative")
    expect(hrefOf("Ouvrir l'opération")).toBe(`/reservations-prets?vue=operations&dossier=${ATTEMPT_ID}`)
    view.unmount()
    const none = fakeGateway()
    renderPage(none, { url: '/reservations-prets' })
    await screen.findByRole('heading', { level: 2, name: '1 réservation' })
    expect(plain(dossier().textContent)).not.toContain("État de la tentative")
    expect(none.getLockerOperation).not.toHaveBeenCalled()
  })

  it('reads the attempt again with « Actualiser »', async () => {
    const gateway = fakeGateway({ reservations: [reservation({ currentOperationId: ATTEMPT_ID })], operations: [attempt({ status: 'COMMAND_SENT', terminalAt: null, confirmedAt: null })] })
    renderPage(gateway, { url: '/reservations-prets' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Commande transmise'))
    await userEvent.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2))
  })

  it('has the same attempt states in English', async () => {
    const acknowledged = attempt({ status: 'COMMAND_ACKNOWLEDGED', doorOpenedAt: null, observationReceivedAt: null, confirmedAt: null, terminalAt: null })
    renderPage(fakeGateway({ reservations: [reservation({ currentOperationId: ATTEMPT_ID })], operations: [acknowledged] }), { url: '/reservations-prets', locale: 'en' })
    await waitFor(() => expect(plain(dossier().textContent)).toContain('Command acknowledged: the locker answered the command. This is not a physical confirmation.'))
    expect(plain(dossier().textContent)).toContain('Physical confirmation is a decision of the server')
    expect(plain(dossier().textContent)).toContain('its expiry is deferred')
  })
})
