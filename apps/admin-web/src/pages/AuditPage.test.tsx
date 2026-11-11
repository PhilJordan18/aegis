import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile } from '../features/auth/testFixtures'
import { OPERATION_ID, SUBJECT_ID, auditPage, eventView, fakeAuditGateway, pageOk, pageProblem, pageUnreachable, uuid } from '../features/audit/testFixtures'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')

const COMMAND = eventView(1, {
  eventType: 'COMMAND_ACKNOWLEDGED',
  subjectType: 'LOCKER_OPERATION',
  operationId: uuid(900),
  fromState: 'COMMAND_SENT',
  toState: 'COMMAND_ACKNOWLEDGED',
  result: 'ACCEPTED',
  actor: null,
})
const REFUSED = eventView(2, { eventType: 'LOCAL_CHALLENGE_REJECTED', subjectType: 'LOCAL_ACCESS_CHALLENGE', result: 'REJECTED', reason: 'CHALLENGE_MISMATCH' })
const UPDATED = eventView(3, { eventType: 'ASSET_UPDATED', subjectType: 'ASSET', details: { field: 'name' } })

function renderAudit(answers: Parameters<typeof fakeAuditGateway>[0], { search = '', locale = 'fr' as Locale }: { search?: string; locale?: Locale } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', `/audit${search}`)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const auditGateway = fakeAuditGateway(answers)
  const view = renderWithProviders(<App />, { gateway: authGateway, auditGateway, session, queryClient, locale })
  return { auditGateway, ...view }
}

const queryOf = (gateway: ReturnType<typeof fakeAuditGateway>, call: number) => gateway.listAuditEvents.mock.calls[call]?.[1]
const timeline = async () => within(await screen.findByRole('region', { name: /événements? chargés?|events? loaded/ }))

configure({ asyncUtilTimeout: 4000 })
beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('Audit (#53, 09 §19.1) — nominal', () => {
  it('shows the read-only notice, the events with a label from their code, and the first one in the dossier', async () => {
    const { auditGateway } = renderAudit([pageOk(auditPage([COMMAND, REFUSED, UPDATED]))])
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit' })).toBeTruthy()
    expect(screen.getByText('Historique non modifiable : aucun événement ne peut être modifié ni supprimé.')).toBeTruthy()
    expect(document.title).toBe('Audit — Aegis Manager')

    const list = await timeline()
    expect(list.getByRole('heading', { level: 2, name: '3 événements chargés' })).toBeTruthy()
    const rows = list.getAllByRole('link')
    expect(rows).toHaveLength(3)
    expect(plain(rows[0]?.textContent)).toContain('Commande acquittée par la cellule')
    expect(plain(rows[0]?.textContent)).toContain('Système')
    expect(plain(rows[0]?.textContent)).toContain('Opération 7c9e6679…')
    expect(plain(rows[0]?.textContent)).toMatch(/Commande transmise\s*→\s*vers Commande acquittée/)
    expect(plain(rows[1]?.textContent)).toContain('Code du casier refusé')
    expect(plain(rows[1]?.textContent)).toContain('Refusé')
    expect(plain(rows[1]?.textContent)).toContain('Administrateur de démonstration')
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')

    const dossier = screen.getByRole('group', { name: 'Commande acquittée par la cellule' })
    // The event type and the state it moved to share one code: both are shown, as sent.
    expect(within(dossier).getAllByText('COMMAND_ACKNOWLEDGED', { selector: 'code' })).toHaveLength(2)
    expect(within(dossier).getByText('LOCKER_OPERATION', { selector: 'code' })).toBeTruthy()
    expect(within(dossier).getByText('COMMAND_SENT', { selector: 'code' })).toBeTruthy()
    expect(within(dossier).getByText("Aucun utilisateur n'est associé à cet événement.")).toBeTruthy()
    expect(within(dossier).getByText('lecture seule')).toBeTruthy()

    expect(auditGateway.listAuditEvents).toHaveBeenCalledTimes(1)
    expect(queryOf(auditGateway, 0)).toEqual({ limit: 50, cursor: undefined })
  })

  it('offers no write action: only reading controls exist', async () => {
    renderAudit([pageOk(auditPage([COMMAND, REFUSED]))])
    await timeline()
    const main = screen.getByRole('main')
    const names = within(main).getAllByRole('button').map((button) => button.textContent?.trim())
    expect(names).toEqual(['Actualiser', 'Filtrer', 'Tout afficher'])
  })

  it('selects another event in the dossier and announces it', async () => {
    renderAudit([pageOk(auditPage([COMMAND, REFUSED]))])
    const list = await timeline()
    await userEvent.setup().click(list.getAllByRole('link')[1] as HTMLElement)
    expect(await screen.findByRole('group', { name: 'Code du casier refusé' })).toBeTruthy()
    expect(window.location.search).toBe(`?evenement=${REFUSED.id}`)
    expect(screen.getAllByRole('status').some((region) => plain(region.textContent) === 'Événement sélectionné : Code du casier refusé.')).toBe(true)
    expect(within(screen.getByRole('group', { name: 'Code du casier refusé' })).getByText('CHALLENGE_MISMATCH')).toBeTruthy()
  })

  it('says what is missing instead of completing it: no result, no reason, no operation, no evidence', async () => {
    renderAudit([pageOk(auditPage([eventView(4, { result: null, reason: null, operationId: null })]))])
    await timeline()
    const dossier = screen.getByRole('group', { name: /./ })
    expect(within(dossier).getAllByText('Résultat non renseigné').length).toBeGreaterThan(0)
    expect(within(dossier).getByText('Aucun motif')).toBeTruthy()
    expect(within(dossier).getByText('Aucune opération associée')).toBeTruthy()
    expect(within(dossier).getByText(/Cet écran n'affiche aucune preuve physique/)).toBeTruthy()
  })

  it('says there are no details when the server sent none', async () => {
    renderAudit([pageOk(auditPage([eventView(4, { details: {} })]))])
    await timeline()
    expect(screen.getByText('Aucun détail')).toBeTruthy()
    expect(screen.queryByText(/ne les affiche pas/)).toBeNull()
  })

  it('shows the scalar details read only, with a label for a known key and the key as sent for another', async () => {
    const details = {
      outcome: 'ACCEPTED',
      operationStatus: 'COMMAND_ACKNOWLEDGED',
      attempt: 2,
      displayInstructionsStopped: true,
      revoked: null,
      reservedUntil: '2026-11-11T20:00:00Z',
      lockerId: SUBJECT_ID,
      futureKey: 'valeur',
      changes: { name: 'secret-looking' },
      endedOperationIds: [OPERATION_ID],
    }
    renderAudit([pageOk(auditPage([eventView(4, { details }), eventView(5)]))])
    await timeline()
    const dossier = screen.getByRole('group', { name: /./ })
    const section = within(dossier).getByRole('heading', { level: 3, name: 'Détails filtrés' }).closest('section') as HTMLElement
    const rows = Object.fromEntries(within(section).getAllByRole('term').map((term) => [plain(term.textContent), plain(term.nextElementSibling?.textContent)]))
    expect(rows).toEqual({
      Issue: 'Accepté ACCEPTED',
      "État de l'opération": 'Commande acquittée COMMAND_ACKNOWLEDGED',
      Tentative: '2',
      "Affichage des consignes arrêté": 'Oui',
      Révoqué: 'Non renseigné',
      "Réservé jusqu'au": expect.stringContaining('2026'),
      'Identifiant du casier': SUBJECT_ID,
      futureKey: 'valeur',
    })
    expect(within(section).getByText('futureKey', { selector: 'code' })).toBeTruthy()
    expect(within(section).getByText('2 champs structurés ne sont pas affichés.')).toBeTruthy()
    expect(section.textContent).not.toContain('secret-looking')
    expect(within(section).queryByRole('button')).toBeNull()
    expect(within(section).queryByRole('textbox')).toBeNull()
  })

  it('says structured details are not shown when they are all that was sent', async () => {
    renderAudit([pageOk(auditPage([eventView(4, { details: { created: { name: 'x' } } })]))])
    await timeline()
    expect(screen.getByText('1 champ structuré n’est pas affiché.')).toBeTruthy()
    expect(screen.queryByText('Aucun détail')).toBeNull()
  })

  it('states the order and that new events appear after a refresh, without claiming a snapshot', async () => {
    renderAudit([pageOk(auditPage([COMMAND, REFUSED]))])
    const list = await timeline()
    expect(list.getByText(/Les plus récents d’abord/)).toBeTruthy()
    expect(list.getByText('Les événements enregistrés après cette lecture apparaissent après « Actualiser ».')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/instantané|snapshot|sans omission|exhaustif/i)
  })

  it('shows an unknown event code as such and an unreadable actor explicitly, and never reads the summary', async () => {
    const odd = eventView(5, { eventType: 'FUTURE_EVENT', actor: 'SYSTEM', summary: 'Texte du serveur' })
    renderAudit([pageOk(auditPage([odd]))])
    const list = await timeline()
    expect(plain(list.getAllByRole('link')[0]?.textContent)).toContain('Événement non reconnu · FUTURE_EVENT')
    expect(plain(list.getAllByRole('link')[0]?.textContent)).toContain('Acteur illisible')
    expect(screen.queryByText('Texte du serveur')).toBeNull()
    expect(screen.getByText('Le serveur a envoyé un acteur que cette version ne sait pas lire. Rien n\'est supposé.')).toBeTruthy()
  })

  it('writes the same screen in English', async () => {
    renderAudit([pageOk(auditPage([COMMAND, REFUSED], { hasMore: true, nextCursor: 'c1' }))], { locale: 'en' })
    const list = await timeline()
    expect(list.getByRole('heading', { level: 2, name: '2 events loaded' })).toBeTruthy()
    expect(screen.getByText('Read-only history: no event can be modified or deleted.')).toBeTruthy()
    expect(plain(list.getAllByRole('link')[0]?.textContent)).toContain('Command acknowledged by the cell')
    expect(plain(list.getAllByRole('link')[0]?.textContent)).toContain('System')
    expect(plain(list.getAllByRole('link')[1]?.textContent)).toContain('Locker code refused')
    expect(list.getByRole('button', { name: 'Load more' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    expect(screen.getByText('Filters')).toBeTruthy()
  })
})

describe('Audit — cursor pagination', () => {
  it('loads more with the opaque cursor unchanged, appends the page, announces it and focuses its first event', async () => {
    const second = [eventView(10, { eventType: 'ASSET_CREATED' }), eventView(11, { eventType: 'ASSET_ARCHIVED' })]
    const { auditGateway } = renderAudit([pageOk(auditPage([COMMAND, REFUSED], { hasMore: true, nextCursor: 'opaque+cursor/==' })), pageOk(auditPage(second))])
    const list = await timeline()
    expect(list.getByText("D'autres événements existent.")).toBeTruthy()
    await userEvent.setup().click(list.getByRole('button', { name: 'Charger plus' }))

    await waitFor(() => expect(list.getAllByRole('link')).toHaveLength(4))
    expect(queryOf(auditGateway, 1)).toEqual({ limit: 50, cursor: 'opaque+cursor/==' })
    expect(list.getByRole('heading', { level: 2, name: '4 événements chargés' })).toBeTruthy()
    expect(list.getByText("Fin de l'historique pour ces filtres.")).toBeTruthy()
    expect(list.queryByRole('button', { name: 'Charger plus' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(list.getAllByRole('link')[2]))
    expect(screen.getAllByRole('status').some((region) => plain(region.textContent) === '2 événements de plus chargés.')).toBe(true)
  })

  it('keeps the loaded events and offers a traced retry when the next page fails', async () => {
    const { auditGateway } = renderAudit([
      pageOk(auditPage([COMMAND, REFUSED], { hasMore: true, nextCursor: 'c1' })),
      pageProblem(503, 'SERVICE_UNAVAILABLE'),
      pageOk(auditPage([UPDATED])),
    ])
    const list = await timeline()
    await userEvent.setup().click(list.getByRole('button', { name: 'Charger plus' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("La suite n'a pas pu être chargée.")).toBeTruthy()
    expect(within(alert).getByText('5f4bc22e-66a4-48ef-8bf3-6e7184d71c30')).toBeTruthy()
    expect(list.getAllByRole('link')).toHaveLength(2)
    expect(list.queryByRole('button', { name: 'Charger plus' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(alert.parentElement))

    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(list.getAllByRole('link')).toHaveLength(3))
    expect(queryOf(auditGateway, 2)).toEqual({ limit: 50, cursor: 'c1' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a persistent, announced notice for a stale cursor and restarts from page 1 on request', async () => {
    const { auditGateway } = renderAudit([
      pageOk(auditPage([COMMAND, REFUSED], { hasMore: true, nextCursor: 'old' })),
      pageProblem(400, 'INVALID_CURSOR'),
      pageOk(auditPage([UPDATED, COMMAND], { hasMore: true, nextCursor: 'fresh' })),
    ])
    const list = await timeline()
    const user = userEvent.setup()
    await user.click(list.getByRole('button', { name: 'Charger plus' }))

    const notice = await screen.findByText('La liste a changé.')
    const status = notice.closest('[role="status"]') as HTMLElement
    expect(status).toBeTruthy()
    expect(within(status).getByText('Recommencez depuis le début.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(list.getAllByRole('link')).toHaveLength(2)
    await waitFor(() => expect(document.activeElement).toBe(status.parentElement))

    await user.click(within(status).getByRole('button', { name: 'Recommencer' }))
    await waitFor(() => expect(screen.queryByText('La liste a changé.')).toBeNull())
    expect(queryOf(auditGateway, 2)).toEqual({ limit: 50, cursor: undefined })
    expect(list.getAllByRole('link').map((link) => link.getAttribute('data-event-id'))).toEqual([UPDATED.id, COMMAND.id])
    expect(screen.getAllByRole('status').some((region) => plain(region.textContent) === 'Historique actualisé : 2 événements chargés.')).toBe(true)
    // Not left on the page body once the notice and its button are gone.
    expect(document.activeElement).not.toBe(document.body)
  })

  it('restarts from page 1 on « Actualiser » and drops the pages that were loaded after it', async () => {
    const { auditGateway } = renderAudit([
      pageOk(auditPage([COMMAND], { hasMore: true, nextCursor: 'c1' })),
      pageOk(auditPage([REFUSED])),
      pageOk(auditPage([UPDATED], { hasMore: true, nextCursor: 'c9' })),
    ])
    const list = await timeline()
    const user = userEvent.setup()
    await user.click(list.getByRole('button', { name: 'Charger plus' }))
    await waitFor(() => expect(list.getAllByRole('link')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(list.getAllByRole('link').map((link) => link.getAttribute('data-event-id'))).toEqual([UPDATED.id]))
    expect(queryOf(auditGateway, 2)).toEqual({ limit: 50, cursor: undefined })
    expect(auditGateway.listAuditEvents).toHaveBeenCalledTimes(3)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actualiser' }))
  })
})

describe('Audit — filters', () => {
  it('sends the laboratory days as an inclusive from and an exclusive to, and the codes as typed', async () => {
    const { auditGateway } = renderAudit([pageOk(auditPage([COMMAND]))], { search: `?du=2026-11-10&au=2026-11-11&type=COMMAND_SENT&operation=${uuid(900)}` })
    await timeline()
    expect(queryOf(auditGateway, 0)).toEqual({
      eventType: 'COMMAND_SENT',
      operationId: uuid(900),
      from: '2026-11-10T05:00:00Z',
      to: '2026-11-12T05:00:00Z',
      limit: 50,
      cursor: undefined,
    })
    expect(screen.getByText('(4 actifs)')).toBeTruthy()
    const chips = screen.getByRole('group', { name: 'Filtres actifs' })
    expect(within(chips).getAllByRole('button')).toHaveLength(4)
  })

  it('applies the form to the address and starts a new walk', async () => {
    const { auditGateway } = renderAudit([pageOk(auditPage([COMMAND])), pageOk(auditPage([REFUSED]))])
    await timeline()
    const user = userEvent.setup()
    await user.click(screen.getByText('Filtres'))
    await user.type(screen.getByLabelText("Type d'événement (code)"), 'LOCAL_CHALLENGE_REJECTED')
    await user.click(screen.getByRole('button', { name: 'Filtrer' }))
    await waitFor(() => expect(window.location.search).toBe('?type=LOCAL_CHALLENGE_REJECTED'))
    await waitFor(() => expect(auditGateway.listAuditEvents).toHaveBeenCalledTimes(2))
    expect(queryOf(auditGateway, 1)).toEqual({ eventType: 'LOCAL_CHALLENGE_REJECTED', limit: 50, cursor: undefined })
  })

  it('removes a filter from its chip and keeps focus on the disclosure', async () => {
    renderAudit([pageOk(auditPage([COMMAND]))], { search: '?type=COMMAND_SENT' })
    await timeline()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Retirer le filtre/ }))
    expect(window.location.search).toBe('')
    expect(document.activeElement?.tagName).toBe('SUMMARY')
  })

  it('says that no event matches the filters, with a way back, and never claims an empty history', async () => {
    renderAudit([pageOk(auditPage([])), pageOk(auditPage([COMMAND]))], { search: '?type=ANOMALY_RESOLVED' })
    expect(await screen.findByText('Aucun événement ne correspond à ces filtres.')).toBeTruthy()
    expect(screen.queryByText('Aucun événement reçu.')).toBeNull()
    expect(screen.queryByText('Événement sélectionné')).toBeNull()
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Tout afficher' }).at(-1) as HTMLElement)
    expect(window.location.search).toBe('')
  })

  it('states an empty answer without filter as what it is', async () => {
    renderAudit([pageOk(auditPage([]))])
    expect(await screen.findByText('Aucun événement reçu.')).toBeTruthy()
    expect(screen.getByText("Le service n'a renvoyé aucun événement.")).toBeTruthy()
    expect(screen.queryByText('Aucun événement ne correspond à ces filtres.')).toBeNull()
  })

  it('shows a 400 on a filter as a filter error against its field, not as empty data', async () => {
    renderAudit([pageProblem(400, 'VALIDATION_ERROR', { violations: [{ field: 'subjectId', code: 'INVALID_VALUE', message: 'Ce paramètre doit être un UUID.' }] })], { search: '?sujet=zzz' })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Un filtre n'est pas valide.")).toBeTruthy()
    expect(screen.queryByText(/Aucun événement ne correspond/)).toBeNull()
    expect(screen.queryByText('Aucun événement reçu.')).toBeNull()
    const field = screen.getByLabelText('Identifiant du sujet')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(within(field.closest('.ag-ff') as HTMLElement).getByText("Cette valeur n'est pas valide.")).toBeTruthy()
    expect(screen.getByLabelText('Type de sujet (code)').getAttribute('aria-invalid')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(screen.queryByText('Événement sélectionné')).toBeNull()
  })

  it('names an inverted period on the closing day', async () => {
    renderAudit([pageProblem(400, 'VALIDATION_ERROR', { violations: [{ field: 'to', code: 'INVALID_VALUE', message: 'x' }] })], { search: '?du=2026-11-12&au=2026-11-10' })
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Au').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText("La période n'est pas valide : « Au » ne peut pas précéder « Du ».")).toBeTruthy()
  })

  it('ignores an address day that is not a day and says so, without sending it', async () => {
    const { auditGateway } = renderAudit([pageOk(auditPage([COMMAND]))], { search: '?du=hier' })
    await timeline()
    expect(queryOf(auditGateway, 0)).toEqual({ limit: 50, cursor: undefined })
    expect(screen.getByLabelText('Du').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText("Ce n'est pas une date : le filtre est ignoré.")).toBeTruthy()
  })
})

describe('Audit — failures', () => {
  it('shows a traced service error with a retry that reads again', async () => {
    const { auditGateway } = renderAudit([pageProblem(500, 'INTERNAL_ERROR'), pageOk(auditPage([COMMAND]))])
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Le service n'a pas pu fournir ces données.")).toBeTruthy()
    expect(within(alert).getByText('5f4bc22e-66a4-48ef-8bf3-6e7184d71c30')).toBeTruthy()
    expect(screen.queryByText(/Aucun événement/)).toBeNull()
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await timeline()
    expect(auditGateway.listAuditEvents).toHaveBeenCalledTimes(2)
  })

  it('does not read a 404 on the list as an empty history: it is a traced service error', async () => {
    renderAudit([pageProblem(404, 'RESOURCE_NOT_FOUND')])
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Le service n'a pas pu fournir ces données.")).toBeTruthy()
    expect(screen.queryByText(/Aucun événement/)).toBeNull()
    expect(screen.queryByText(/pas encore disponible/i)).toBeNull()
  })

  it('says the service is unreachable, without a trace id', async () => {
    renderAudit([pageUnreachable])
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Connexion au service impossible.')).toBeTruthy()
    expect(screen.queryByText(/Identifiant de suivi/)).toBeNull()
  })

  it('shows the refusal for a forbidden account and loads nothing', async () => {
    const { auditGateway } = renderAudit([pageProblem(403, 'FORBIDDEN')])
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Votre compte n'a pas accès à l'audit.")).toBeTruthy()
    expect(within(alert).queryByRole('button', { name: 'Réessayer' })).toBeNull()
    expect(auditGateway.listAuditEvents).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Événement sélectionné')).toBeNull()
  })

  it('leaves the protected area when the session has ended, showing no data', async () => {
    const { session } = renderAudit([pageProblem(401, 'AUTH_TOKEN_EXPIRED')])
    await waitFor(() => expect(session.getAccessToken()).toBeNull())
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(screen.queryByText('Commande acquittée par la cellule')).toBeNull()
  })

  it('keeps the events and says they are stale when a refresh fails, then recovers', async () => {
    renderAudit([pageOk(auditPage([COMMAND, REFUSED])), pageUnreachable, pageOk(auditPage([UPDATED]))])
    const list = await timeline()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Données non actualisées.')).toBeTruthy()
    expect(plain(alert.textContent)).toMatch(/Les événements affichés ont été lus à \d+ h \d+ [A-Z]+\./)
    expect(list.getAllByRole('link')).toHaveLength(2)

    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(list.getAllByRole('link')).toHaveLength(1))
    expect(screen.queryByText('Données non actualisées.')).toBeNull()
  })
})
