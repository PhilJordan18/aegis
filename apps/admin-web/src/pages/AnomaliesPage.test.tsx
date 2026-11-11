import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import type { AnomalyGateway } from '../features/anomalies/anomalyGateway'
import { anomalyPageOf, fakeAnomalyGateway, OBSERVATION_ID, ok, OPERATION_ID, parsedAnomaly, parsedDetail, SECOND_ID, THIRD_ID } from '../features/anomalies/testFixtures'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import type { ProblemResponse } from '../features/auth/contract'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { Locale } from '../i18n/locale'
import { installDialogPolyfill } from '../test/dialog'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const problem = (status: number, code: string, extra: Partial<ProblemResponse> = {}) =>
  ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId: 'trace-0001', ...extra }), retryAfter: null, requestId: 'req-x' }) as const
const offline = { kind: 'network', reason: 'offline' } as const

configure({ asyncUtilTimeout: 4000 })
beforeAll(installDialogPolyfill)
beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

const HIGH_OPEN = parsedAnomaly()
const LOW_OPEN = parsedAnomaly({ id: SECOND_ID, severity: 'LOW', type: 'COMMAND_REJECTED', assetId: null, detectedAt: '2026-11-10T18:00:00Z' })
const MEDIUM_ACK = parsedAnomaly({
  id: THIRD_ID,
  severity: 'MEDIUM',
  type: 'DOOR_NOT_CLOSED_BEFORE_EXPIRY',
  status: 'ACKNOWLEDGED',
  acknowledgedAt: '2026-11-10T19:10:00Z',
  acknowledgedBy: { id: '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8', displayName: 'Administrateur de démonstration' },
  acknowledgementNote: 'Inspection planifiée.',
  detectedAt: '2026-11-10T17:00:00Z',
})

/** Detail answers by id: the list's copy plus an empty evidence section, unless a test scripts another. */
function detailsOf(...views: ReturnType<typeof parsedAnomaly>[]): AnomalyGateway['getAnomaly'] {
  return async (_token, id) => {
    const found = views.find((view) => view.id === id)
    return found === undefined ? problem(404, 'RESOURCE_NOT_FOUND') : ok({ ...found, evidence: { items: [], unreadable: 0 } })
  }
}

function renderAnomalies(anomalyGateway: AnomalyGateway, { locale = 'fr', url = '/anomalies' }: { locale?: Locale; url?: string } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-11-11T20:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, anomalyGateway, session, queryClient, locale })
}

const listEl = () => document.querySelector('.ag-list__items') as HTMLElement
const listOf = (...views: ReturnType<typeof parsedAnomaly>[]) => ok(anomalyPageOf(views))

describe('Anomalies — list and dossier', () => {
  it('opens on « Ouvertes », lists the open anomalies newest first and shows the first one in the dossier', async () => {
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN, LOW_OPEN), getAnomaly: detailsOf(HIGH_OPEN, LOW_OPEN) })
    renderAnomalies(gateway)
    expect(await screen.findByRole('heading', { level: 1, name: 'Anomalies' })).toBeDefined()
    await screen.findByText('2 anomalies')
    expect(screen.getByText(/Les plus récentes d’abord, selon l’heure de détection · lu à/)).toBeDefined()
    expect(gateway.listAnomalies.mock.calls[0]?.[1]).toEqual({ status: 'OPEN', page: 0, size: 20 })
    expect((screen.getByRole('combobox', { name: 'Statut' }) as HTMLSelectElement).value).toBe('OPEN')
    const rows = within(listEl()).getAllByRole('link')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Gravité élevée')
    expect(rows[0]?.textContent).toContain('Ouverte')
    expect(rows[0]?.textContent).toContain('Équipement attendu non observé')
    // Identifiers only (G3): shortened in the row, whole in the dossier.
    expect(rows[0]?.textContent).toContain('Cellule 4e5f6071…')
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')
    const dossier = await screen.findByRole('group', { name: 'Équipement attendu non observé' })
    await within(dossier).findByText('Aucune observation n’est référencée par cette anomalie.')
    expect(within(dossier).getByText('4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b')).toBeDefined()
    expect(within(dossier).getAllByText('Identifiant seulement').length).toBeGreaterThan(0)
    // The permanent reminder, and never a resolve action.
    expect(screen.getByText(/Une anomalie se résout seulement lorsqu’une nouvelle observation du casier le confirme/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /résoudre|resolve/i })).toBeNull()
    expect(within(dossier).getByRole('button', { name: 'Reconnaître' })).toBeDefined()
    expect(within(dossier).getByText('Ne résout pas l’anomalie.')).toBeDefined()
  })

  it('shows the French server summary as the label of an unknown type, with the raw code in the dossier', async () => {
    const odd = parsedAnomaly({ id: SECOND_ID, type: 'NEW_FAULT_KIND', summary: 'Texte du serveur pour un type inconnu.' })
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN, odd), getAnomaly: detailsOf(HIGH_OPEN, odd) })
    renderAnomalies(gateway)
    await screen.findByText('2 anomalies')
    // A known type stays localized from `type`: its summary is never shown.
    expect(document.body.textContent).not.toContain('Équipement attendu non lu après la fermeture')
    expect(within(listEl()).getByText('Texte du serveur pour un type inconnu.')).toBeDefined()
    await userEvent.click(within(listEl()).getByText('Texte du serveur pour un type inconnu.'))
    const dossier = await screen.findByRole('group', { name: 'Texte du serveur pour un type inconnu.' })
    expect(within(dossier).getByText('NEW_FAULT_KIND')).toBeDefined()
    expect(within(dossier).getByText('Type non reconnu par cette version')).toBeDefined()
  })

  it('shows the raw code of an unknown type in French when the summary is empty or blank', async () => {
    const odd = parsedAnomaly({ id: SECOND_ID, type: 'NEW_FAULT_KIND', summary: '   ' })
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN, odd), getAnomaly: detailsOf(HIGH_OPEN, odd) }))
    await screen.findByText('2 anomalies')
    expect(within(listEl()).getByText('NEW_FAULT_KIND')).toBeDefined()
  })

  it('never shows the server summary in English: an unknown type is its raw code, marked as unrecognized', async () => {
    const odd = parsedAnomaly({ id: SECOND_ID, type: 'NEW_FAULT_KIND', summary: 'Texte du serveur pour un type inconnu.' })
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN, odd), getAnomaly: detailsOf(HIGH_OPEN, odd) }), { locale: 'en' })
    await screen.findByText('2 anomalies')
    expect(within(listEl()).getByText('NEW_FAULT_KIND')).toBeDefined()
    await userEvent.click(within(listEl()).getByText('NEW_FAULT_KIND'))
    const dossier = await screen.findByRole('group', { name: 'NEW_FAULT_KIND' })
    expect(within(dossier).getByText('Type not recognized by this version')).toBeDefined()
    expect(within(dossier).getByText(/not recognized by this version of the application/)).toBeDefined()
    expect(document.body.textContent).not.toContain('Texte du serveur')
    expect(document.body.textContent).not.toContain('Équipement attendu non lu')
  })

  it('shows the acknowledged anomaly as « Reconnue » with its author and note, without an acknowledge button', async () => {
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(MEDIUM_ACK), getAnomaly: detailsOf(MEDIUM_ACK) })
    renderAnomalies(gateway, { url: '/anomalies?statut=reconnues' })
    const dossier = await screen.findByRole('group', { name: 'Porte non refermée avant l’échéance' })
    expect(within(dossier).getAllByText('Reconnue').length).toBeGreaterThan(0)
    expect(within(dossier).getByText(/Reconnue par Administrateur de démonstration à/)).toBeDefined()
    expect(within(dossier).getByText('Inspection planifiée.')).toBeDefined()
    expect(within(dossier).queryByRole('button', { name: 'Reconnaître' })).toBeNull()
    expect(within(dossier).getByText(/Reconnue : la vérification est engagée/)).toBeDefined()
    expect(within(dossier).getByText(/Non résolue/)).toBeDefined()
  })

  it('states the 50-observation limit and that the evidence is not the complete history, read-only and parsed leniently', async () => {
    const detail = parsedDetail({
      evidence: [
        { observationId: OBSERVATION_ID, type: 'DOOR_CLOSED', compartmentId: null, operationId: OPERATION_ID, observedAt: '2026-11-10T19:01:00Z', receivedAt: '2026-11-10T19:01:02Z' },
        { observationId: 'not-a-uuid' },
      ],
    })
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: async () => ok(detail) })
    renderAnomalies(gateway)
    const dossier = await screen.findByRole('group', { name: 'Équipement attendu non observé' })
    await within(dossier).findByText('DOOR_CLOSED')
    expect(within(dossier).getByText(/Au plus 50 observations, sélectionnées par le serveur : ce n’est pas l’historique complet/)).toBeDefined()
    expect(within(dossier).queryByText(/la limite est atteinte/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/provisoire|non approuvée/i)
    expect(within(dossier).getByText(OBSERVATION_ID)).toBeDefined()
    expect(within(dossier).getByText('1 entrée illisible a été ignorée.')).toBeDefined()
  })

  it('says the limit is reached when exactly 50 observations are shown, in French and English', async () => {
    const evidence = Array.from({ length: 50 }, (_, index) => ({
      observationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      type: 'DOOR_CLOSED',
      compartmentId: null,
      operationId: null,
      observedAt: '2026-11-10T19:01:00Z',
      receivedAt: null,
    }))
    const detail = parsedDetail({ evidence })
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: async () => ok(detail) })
    const view = renderAnomalies(gateway)
    const dossier = await screen.findByRole('group', { name: 'Équipement attendu non observé' })
    expect(await within(dossier).findByText(/50 observations affichées : la limite est atteinte/)).toBeDefined()
    expect(within(dossier).getByText(/ce n’est pas l’historique complet/)).toBeDefined()
    view.unmount()
    renderAnomalies(gateway, { locale: 'en' })
    const dossierEn = await screen.findByRole('group', { name: 'Expected equipment not observed' })
    expect(await within(dossierEn).findByText(/50 observations shown: the limit is reached/)).toBeDefined()
    expect(within(dossierEn).getByText(/not the complete history/)).toBeDefined()
  })

  it('says evidence is not available when the server sent no section', async () => {
    const detail = { ...parsedDetail(), evidence: null }
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: async () => ok(detail) }))
    expect(await screen.findByText('Preuves non disponibles dans cette version.')).toBeDefined()
  })

  it('renders in English', async () => {
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: detailsOf(HIGH_OPEN) }), { locale: 'en' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Anomalies' })).toBeDefined()
    await screen.findByText('1 anomaly')
    expect(screen.getByText(/Newest first, by detection time · read at/)).toBeDefined()
    expect(screen.getByText(/An anomaly is resolved only when a new observation from the locker confirms it/)).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Acknowledge' })).toBeDefined()
    expect(screen.getByText('Does not resolve the anomaly.')).toBeDefined()
    expect(screen.getAllByText('High severity').length).toBeGreaterThan(0)
  })
})

describe('Anomalies — address, filters and pagination', () => {
  it('reads the filters from the address and sends only those', async () => {
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(MEDIUM_ACK), getAnomaly: detailsOf(MEDIUM_ACK) })
    renderAnomalies(gateway, { url: '/anomalies?statut=reconnues&gravite=moyenne&type=DOOR_NOT_CLOSED_BEFORE_EXPIRY&page=1' })
    await screen.findByText('1 anomalie')
    expect(gateway.listAnomalies.mock.calls[0]?.[1]).toEqual({ status: 'ACKNOWLEDGED', type: 'DOOR_NOT_CLOSED_BEFORE_EXPIRY', severity: 'MEDIUM', page: 0, size: 20 })
    expect((screen.getByRole('combobox', { name: 'Gravité' }) as HTMLSelectElement).value).toBe('MEDIUM')
  })

  it('ignores unusable values and lists every status when the address names an anomaly', async () => {
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(MEDIUM_ACK), getAnomaly: detailsOf(MEDIUM_ACK) })
    renderAnomalies(gateway, { url: `/anomalies?anomalie=${THIRD_ID}&gravite=critique&type=X&page=zéro` })
    await screen.findByText('1 anomalie')
    expect(gateway.listAnomalies.mock.calls[0]?.[1]).toEqual({ page: 0, size: 20 })
    expect(gateway.getAnomaly.mock.calls[0]?.[1]).toBe(THIRD_ID)
  })

  it('applies the filters with « Filtrer », resets the page and writes the address', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: detailsOf(HIGH_OPEN) })
    renderAnomalies(gateway, { url: '/anomalies?page=3' })
    await screen.findByText('1 anomalie')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gravité' }), 'HIGH')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Statut' }), '')
    await user.click(screen.getByRole('button', { name: 'Filtrer' }))
    expect(window.location.search).toBe('?statut=toutes&gravite=elevee')
    await waitFor(() => expect(gateway.listAnomalies.mock.calls.at(-1)?.[1]).toEqual({ severity: 'HIGH', page: 0, size: 20 }))
  })

  it('shows the filtered empty state with « Tout afficher », never « no record » under a filter', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({
      listAnomalies: async (_token, query) => ok(anomalyPageOf(query.severity === undefined && query.status === undefined ? [HIGH_OPEN] : [])),
      getAnomaly: detailsOf(HIGH_OPEN),
    })
    renderAnomalies(gateway, { url: '/anomalies?gravite=faible' })
    expect(await screen.findByText('Aucune anomalie ne correspond à ces filtres.')).toBeDefined()
    expect(screen.queryByText('Aucune anomalie n’est enregistrée.')).toBeNull()
    await user.click(within(document.querySelector('.ag-list__empty') as HTMLElement).getByRole('button', { name: 'Tout afficher' }))
    await screen.findByText('1 anomalie')
    expect(window.location.search).toBe('?statut=toutes')
  })

  it('says there is none only when nothing is filtered', async () => {
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => listOf() }), { url: '/anomalies?statut=toutes' })
    expect(await screen.findByText('Aucune anomalie n’est enregistrée.')).toBeDefined()
  })

  it('pages with Précédent and Suivant, one-based in the address', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({
      listAnomalies: async (_token, query) => ok(anomalyPageOf(query.page === 0 ? [HIGH_OPEN] : [LOW_OPEN], { page: query.page, totalItems: 22, totalPages: 2 })),
      getAnomaly: detailsOf(HIGH_OPEN, LOW_OPEN),
    })
    renderAnomalies(gateway)
    await screen.findByText('22 anomalies')
    expect(screen.getByText('Page 1 sur 2')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Précédent' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Suivant' }))
    await screen.findByText('Page 2 sur 2')
    expect(window.location.search).toBe('?page=2')
    expect(gateway.listAnomalies.mock.calls.at(-1)?.[1]).toEqual({ status: 'OPEN', page: 1, size: 20 })
  })

  it('goes back to the last page when the address is past the end', async () => {
    const gateway = fakeAnomalyGateway({
      listAnomalies: async (_token, query) => ok(anomalyPageOf(query.page === 0 ? [HIGH_OPEN] : [], { page: query.page, totalItems: 1, totalPages: 1 })),
      getAnomaly: detailsOf(HIGH_OPEN),
    })
    renderAnomalies(gateway, { url: '/anomalies?page=9' })
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('selects with a link, keeps the filters in the address, and follows back and a direct URL', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN, LOW_OPEN), getAnomaly: detailsOf(HIGH_OPEN, LOW_OPEN) })
    renderAnomalies(gateway)
    await screen.findByText('2 anomalies')
    const second = within(listEl()).getAllByRole('link')[1] as HTMLAnchorElement
    expect(second.getAttribute('href')).toBe(`/anomalies?statut=ouvertes&anomalie=${SECOND_ID}`)
    await user.click(second)
    expect(window.location.search).toBe(`?statut=ouvertes&anomalie=${SECOND_ID}`)
    await screen.findByRole('group', { name: 'Commande rejetée' })
    expect(second.getAttribute('aria-current')).toBe('true')
    // Side by side, focus stays on the row and a live region announces the dossier.
    expect(document.activeElement).toBe(second)
    expect(screen.getByText(/Anomalie sélectionnée.*Commande rejetée/)).toBeDefined()
    window.history.back()
    await waitFor(() => expect(screen.getByRole('group', { name: 'Équipement attendu non observé' })).toBeDefined())
  })

  it('moves focus to the dossier on a stacked layout', async () => {
    installMatchMedia(window, true)
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN, LOW_OPEN), getAnomaly: detailsOf(HIGH_OPEN, LOW_OPEN) })
    renderAnomalies(gateway)
    await screen.findByText('2 anomalies')
    await user.click(within(listEl()).getAllByRole('link')[1] as HTMLElement)
    const dossier = await screen.findByRole('group', { name: 'Commande rejetée' })
    await waitFor(() => expect(document.activeElement).toBe(dossier))
  })
})

describe('Anomalies — failure states', () => {
  it('shows skeleton rows with a busy list while loading', async () => {
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: () => new Promise(() => undefined) }))
    const status = await screen.findByText('Chargement des anomalies…')
    expect(status).toBeDefined()
    expect(document.querySelector('.ag-list[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/anomalies?$/)).toBeNull()
  })

  it('reports an unreachable service as a warning with « Réessayer » and no trace ID', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => offline })
    renderAnomalies(gateway)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Connexion au service impossible.')).toBeDefined()
    expect(screen.queryByText(/Identifiant de suivi/)).toBeNull()
    gateway.listAnomalies.mockImplementation(async () => listOf(HIGH_OPEN))
    gateway.getAnomaly.mockImplementation(detailsOf(HIGH_OPEN))
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await screen.findByText('1 anomalie')
  })

  it('shows the trace ID of a service error, selectable, and never an empty list', async () => {
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => problem(500, 'INTERNAL_ERROR') }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Le service n’a pas pu fournir ces données.')).toBeDefined()
    expect(within(alert).getByText('trace-0001').tagName).toBe('CODE')
    expect(screen.queryByText(/Aucune anomalie/)).toBeNull()
  })

  it('treats a 404 on the list as a traced service error, never as empty or « not available yet »', async () => {
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => problem(404, 'RESOURCE_NOT_FOUND') }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Le service n’a pas pu fournir ces données.')).toBeDefined()
    expect(within(alert).getByText('trace-0001')).toBeDefined()
    expect(screen.queryByText(/Aucune anomalie|pas encore disponible|bientôt/i)).toBeNull()
  })

  it('refuses in place on a 403, with no retry', async () => {
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => problem(403, 'FORBIDDEN') }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Votre compte n’a pas accès aux anomalies.')).toBeDefined()
    expect(within(alert).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('group', { name: /./ })).toBeNull()
  })

  it('leaves the session to the store on a 401: no data, no alert', async () => {
    const { session } = renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => problem(401, 'AUTH_TOKEN_EXPIRED') }))
    await waitFor(() => expect(session.getAccessToken()).toBeNull())
    expect(screen.queryByText('1 anomalie')).toBeNull()
  })

  it('keeps the list and says it is stale when a refresh fails', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: detailsOf(HIGH_OPEN) })
    renderAnomalies(gateway)
    await screen.findByText('1 anomalie')
    gateway.listAnomalies.mockImplementation(async () => offline)
    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    const notice = await screen.findByText('Données non actualisées.')
    expect(notice).toBeDefined()
    expect(screen.getByText(/Les données affichées ont été lues à/)).toBeDefined()
    expect(within(listEl()).getAllByRole('link')).toHaveLength(1)
  })

  it('shows « Dossier introuvable » for an unknown anomaly and leaves the list usable', async () => {
    const user = userEvent.setup()
    const missing = '00000000-0000-4000-8000-000000000000'
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: detailsOf(HIGH_OPEN) })
    renderAnomalies(gateway, { url: `/anomalies?anomalie=${missing}` })
    expect(await screen.findByText('Dossier introuvable.')).toBeDefined()
    expect(within(listEl()).getAllByRole('link')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Retour à la liste' }))
    await waitFor(() => expect(window.location.search).toBe('?statut=toutes'))
  })

  it('keeps the list fields when only the detail fails (partial), with a retry of the detail', async () => {
    const user = userEvent.setup()
    const gateway = fakeAnomalyGateway({ listAnomalies: async () => listOf(HIGH_OPEN), getAnomaly: async () => problem(500, 'INTERNAL_ERROR') })
    renderAnomalies(gateway)
    const dossier = await screen.findByRole('group', { name: 'Équipement attendu non observé' })
    const alert = await within(dossier).findByRole('alert')
    expect(within(alert).getByText('Le détail (preuves) n’a pas pu être chargé.')).toBeDefined()
    expect(within(alert).getByText('trace-0001')).toBeDefined()
    // The list fields are still there, and the one action stays available.
    expect(within(dossier).getByText('4e5f6071-8293-4aa4-9bb5-d6e7f8091a2b')).toBeDefined()
    gateway.getAnomaly.mockImplementation(detailsOf(HIGH_OPEN))
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await within(dossier).findByText('Aucune observation n’est référencée par cette anomalie.')
  })

  it('does not treat an unknown severity or status as a known one', async () => {
    const odd = parsedAnomaly({ severity: 'CRITICAL', status: 'ARCHIVED' })
    renderAnomalies(fakeAnomalyGateway({ listAnomalies: async () => listOf(odd), getAnomaly: detailsOf(odd) }), { url: '/anomalies?statut=toutes' })
    const dossier = await screen.findByRole('group', { name: 'Équipement attendu non observé' })
    expect(within(dossier).getByText('Gravité non reconnue')).toBeDefined()
    expect(within(dossier).getByText('Statut non reconnu')).toBeDefined()
    expect(within(dossier).queryByRole('button', { name: 'Reconnaître' })).toBeNull()
    expect(within(dossier).queryByText(/Non résolue/)).toBeNull()
  })
})
