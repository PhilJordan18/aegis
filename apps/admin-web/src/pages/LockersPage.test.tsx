import { act, cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../api/queryKeys'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { CatalogGateway } from '../features/catalog/catalogGateway'
import { asset, fakeCatalogGateway, MM001, MM002, ok as catalogOk, pageOf } from '../features/catalog/testFixtures'
import { UNRECOGNIZED } from '../features/catalog/contract'
import type { LockerGateway } from '../features/lockers/lockerGateway'
import { A1, A2, compartment, DEMO_LOCKER_ID, fakeLockerGateway, lockerStatus, NEVER_SEEN, OFFLINE, ok } from '../features/lockers/testFixtures'
import { LOCKER_STATUS_REFRESH_MS } from '../features/lockers/useLockerStatus'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const offline = { kind: 'network', reason: 'offline' } as const
const failure = (status: number, code: string, traceId = 'trace-0001') =>
  ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId }), retryAfter: null, requestId: 'req-x' }) as const

/** The catalog places one unit in the demo locker, as the live API does once a unit is placed. */
const PLACED = {
  ...MM001,
  placement: { lockerId: DEMO_LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1.id, compartmentCode: 'A1' },
}
const placedCatalog = () => fakeCatalogGateway({ pages: [catalogOk(pageOf([PLACED, MM002]))] })

function renderLockers(
  lockerGateway: LockerGateway,
  { catalogGateway = placedCatalog(), locale = 'fr', url = '/casiers' }: { catalogGateway?: CatalogGateway; locale?: Locale; url?: string } = {},
) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return { catalogGateway, ...renderWithProviders(<App />, { gateway: authGateway, catalogGateway, lockerGateway, session, queryClient, locale }) }
}

const panel = () => screen.getByRole('region', { name: /AEGIS-DEMO-01/ }) as HTMLElement
const SECTION = /Casier de démonstration du laboratoire · AEGIS-DEMO-01/

configure({ asyncUtilTimeout: 4000 })

beforeEach(() => {
  installMatchMedia(window, false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('Casiers — nominal', () => {
  it('finds the locker through the catalog placement and reads its status with the session token', async () => {
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    const { catalogGateway } = renderLockers(gateway)

    expect(await screen.findByRole('heading', { level: 2, name: SECTION })).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Casiers' })).toBeDefined()
    expect(document.title).toBe('Casiers — Aegis Manager')
    expect(gateway.getStatus).toHaveBeenCalledTimes(1)
    expect(gateway.getStatus.mock.calls[0]?.[0]).toBe('token-value')
    expect(gateway.getStatus.mock.calls[0]?.[1]).toBe(DEMO_LOCKER_ID)
    expect(catalogGateway.listAssets).toHaveBeenCalledTimes(1)
  })

  it('shows the connection chip, the last signal, the evaluation time and the open window in the locker zone', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).toContain('En ligne')
    expect(text).toMatch(/Dernier signal : 3 nov\. 2026, \d+ h \d\d [A-Z]+/)
    expect(text).toMatch(/Évalué par le serveur à 3 nov\. 2026, \d+ h \d\d/)
    expect(text).toContain("Horaire d'exploitation")
    expect(text).toContain('Ouvert')
    // 22:00Z is 17 h in Toronto in November, whatever the device zone.
    expect(text).toContain('Fermeture3 nov. 2026, 17 h 00 HNE')
    expect(text).toContain('Fuseau du casier : America/Toronto')
    expect(text).not.toContain('Prochaine ouverture')
  })

  it('lists each compartment with enabled, link, reader, door, lock and last observation', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const table = within(panel()).getByRole('table', { name: 'Cellules du casier AEGIS-DEMO-01' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Cellule', 'Activée', 'Liaison', 'Lecteur RFID', 'Porte', 'Serrure', 'Dernière observation',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0] as HTMLElement).getByRole('rowheader').textContent).toBe('A1')
    const cells = within(rows[0] as HTMLElement).getAllByRole('cell').map((cell) => plain(cell.textContent))
    expect(cells.slice(0, 5)).toEqual(['ActivéeOui', 'LiaisonConnectée', 'Lecteur RFIDEn bon état', 'PorteFermée', 'SerrureVerrouillée'])
    expect(cells[5]).toMatch(/^Dernière observation3 nov\. 2026, \d+ h \d\d/)
    expect(panel().textContent).toContain('2 cellules')
  })

  it('says a locker with no compartment has none', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus({ compartments: [] }))] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(screen.getByText('Aucune cellule déclarée pour ce casier.')).toBeDefined()
    expect(within(panel()).queryByRole('table')).toBeNull()
  })

  it('is read only: no button, field, form or command, and the gateway is only asked to read', async () => {
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    renderLockers(gateway)
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const main = screen.getByRole('main')
    expect(within(main).queryAllByRole('button')).toHaveLength(0)
    expect(main.querySelectorAll('input, select, textarea, form, [contenteditable], [role="switch"], [role="checkbox"]')).toHaveLength(0)
    expect(within(main).queryByText(/ouvrir|forcer|déverrouiller|débloquer|modifier|enregistrer/i)).toBeNull()
    expect(Object.keys(gateway)).toEqual(['getStatus'])
    expect(plain(main.textContent)).toContain("Lecture seule : aucune commande n'est envoyée au casier depuis cet écran.")
  })

  it('shows the same screen in English', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] }), { locale: 'en' })
    await screen.findByRole('heading', { level: 2, name: /AEGIS-DEMO-01/ })
    const text = plain(document.body.textContent)
    expect(document.title).toBe('Lockers — Aegis Manager')
    expect(text).toContain('Online')
    expect(text).toMatch(/Last seen at Nov 3, 2026, \d+:\d\d [ap]\.m\. [A-Z]+/)
    expect(text).toContain('Operating hours')
    expect(text).toContain('Locker time zone: America/Toronto')
    expect(text).toMatch(/Closes\s*Nov 3, 2026, 5:00 p\.m\. EST/)
    expect(text).toContain('RFID reader')
    expect(text).not.toMatch(/En ligne|Dernier signal|Horaire|Cellule|Last signal/)
  })
})

describe('Casiers — where the locker comes from', () => {
  it('reads the locker named in the address and does not read the catalog', async () => {
    const other = '11111111-2222-4333-8444-555555555555'
    const gateway = fakeLockerGateway({ [other]: [ok(lockerStatus({ lockerId: other }))] })
    const { catalogGateway } = renderLockers(gateway, { url: `/casiers?casier=${other.toUpperCase()}` })
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(gateway.getStatus.mock.calls.map((call) => call[1])).toEqual([other])
    expect(catalogGateway.listAssets).not.toHaveBeenCalled()
  })

  it('ignores an address that is not a UUID instead of putting it in a request path', async () => {
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    renderLockers(gateway, { url: '/casiers?casier=../auth/me' })
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(gateway.getStatus.mock.calls.every((call) => call[1] === DEMO_LOCKER_ID)).toBe(true)
  })

  it('shows each placed locker once, however many units are in it', async () => {
    const second = { ...MM002, placement: { lockerId: DEMO_LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A2.id, compartmentCode: 'A2' } }
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    renderLockers(gateway, { catalogGateway: fakeCatalogGateway({ pages: [catalogOk(pageOf([PLACED, second]))] }) })
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
    expect(gateway.getStatus).toHaveBeenCalledTimes(1)
  })

  it('says no locker was found among the placed units, hints at ?casier=, and reads no status', async () => {
    const gateway = fakeLockerGateway()
    renderLockers(gateway, { catalogGateway: fakeCatalogGateway({ pages: [catalogOk(pageOf([asset({ id: 'x', assetCode: 'X-1' })]))] }) })
    expect(await screen.findByText('Aucun casier trouvé parmi les équipements placés.')).toBeDefined()
    expect(plain(document.body.textContent)).toContain('/casiers?casier=identifiant')
    expect(gateway.getStatus).not.toHaveBeenCalled()
  })

  it('reports an unreachable catalog with a retry that finds the locker', async () => {
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    const catalogGateway = fakeCatalogGateway({ pages: [offline] })
    renderLockers(gateway, { catalogGateway })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Connexion au service impossible.')
    catalogGateway.listAssets.mockResolvedValueOnce(catalogOk(pageOf([PLACED])))
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { level: 2, name: SECTION })).toBeDefined()
  })
})

describe('Casiers — states of the connection', () => {
  it('OFFLINE as the server sends it: the cells keep the last heartbeat values, shown as the last known state and never as current health', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(OFFLINE)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).toContain('Hors ligne')
    expect(text).toContain("Le casier n'envoie plus de signal valide.")
    expect(text).toMatch(/Dernier signal : 3 nov\. 2026, \d+ h 32/)
    expect(text).not.toContain('En ligne')
    // The server's values stay visible, exactly...
    for (const value of ['Connectée', 'En bon état', 'Fermée', 'Verrouillée']) expect(text).toContain(value)
    // ...under a note that says they are a memory, and without any chip that would present them as health or fault.
    expect(text).toContain("Dernier état connu, à la dernière observation : le casier n'est pas en ligne, ces valeurs ne sont pas l'état actuel.")
    const table = within(panel()).getByRole('table')
    expect(table.querySelectorAll('.ag-chip')).toHaveLength(0)
    expect(table.getAttribute('aria-describedby')).toBe(panel().querySelector('.ag-lk__lastknown')?.id)
  })

  it('OFFLINE with a faulted or open cell: still the last known value, neutral, and the value is not hidden', async () => {
    const status = lockerStatus({
      ...OFFLINE,
      compartments: [compartment({ ...A1, doorState: 'OPEN', rfidReaderStatus: 'FAULTED', lastObservedAt: '2026-11-03T14:31:50Z' }), A2],
    })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(status)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const table = within(panel()).getByRole('table')
    expect(table.querySelectorAll('.ag-chip')).toHaveLength(0)
    expect(plain(table.textContent)).toContain('En défaut')
    expect(plain(table.textContent)).toContain('Ouverte')
  })

  it('ONLINE: no last-known note, and an exception keeps its chip', async () => {
    const status = lockerStatus({ compartments: [compartment({ ...A1, doorState: 'OPEN' })] })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(status)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(panel().querySelector('.ag-lk__lastknown')).toBeNull()
    expect(within(panel()).getByRole('table').querySelectorAll('.ag-chip')).toHaveLength(1)
  })

  it('UNKNOWN (never seen): says no signal was ever received, and shows no compartment as healthy', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(NEVER_SEEN)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).toContain('État inconnu')
    expect(text).toContain('Aucun signal reçu')
    expect(text).toContain("Aucun signal valide n'a encore été reçu")
    expect(text).toContain('Aucune observation')
    expect(text).not.toMatch(/En ligne|Connectée|En bon état|Fermée|Verrouillée/)
    // Nothing was ever observed, so there is no last known state to describe: the cells keep their own unknown chips.
    expect(text).not.toContain('Dernier état connu')
    expect(within(panel()).getByRole('table').querySelectorAll('.ag-chip').length).toBeGreaterThan(0)
  })

  it('never derives ONLINE from the timestamps: the status field is the only authority', async () => {
    const old = lockerStatus({ connectionStatus: 'ONLINE', lastSeenAt: '2020-01-01T00:00:00Z' })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(old)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(plain(panel().textContent)).toContain('En ligne')
    cleanup()
    const recent = lockerStatus({ connectionStatus: 'OFFLINE', lastSeenAt: '2026-11-03T14:59:59Z' })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(recent)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(plain(panel().textContent)).toContain('Hors ligne')
    expect(plain(panel().textContent)).not.toContain('En ligne')
  })

  it('an unrecognized value is an unavailable state with a note, never a healthy one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gateway = fakeLockerGateway({
      [DEMO_LOCKER_ID]: [{ kind: 'ok', requestId: 'r', value: lockerStatus({ connectionStatus: UNRECOGNIZED, compartments: [{ ...A1, doorState: UNRECOGNIZED }, A2] }) }],
    })
    renderLockers(gateway)
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).not.toContain('En ligne')
    expect(text).toContain('État indisponible')
    expect(text).toContain('Une valeur envoyée par le serveur')
    // The other compartment still reads normally.
    expect(text).toContain('Fermée')
  })

  it('open door and unlocked lock are shown as facts, with their own text', async () => {
    const status = lockerStatus({ compartments: [compartment({ ...A1, doorState: 'OPEN', lockState: 'UNLOCKED', rfidReaderStatus: 'FAULTED', enabled: false })] })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(status)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).toContain('Ouverte')
    expect(text).toContain('Déverrouillée')
    expect(text).toContain('En défaut')
    expect(text).toContain('ActivéeNon')
  })
})

describe('Casiers — operating window', () => {
  it('closed: says so with the next opening in the locker zone', async () => {
    const status = lockerStatus({ currentWindow: { timeZone: 'America/Toronto', open: false, closesAt: null, nextOpensAt: '2026-11-04T13:00:00Z' } })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(status)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).toContain('Fermé')
    expect(text).toContain('Prochaine ouverture4 nov. 2026, 08 h 00 HNE')
    expect(text).not.toContain('Fermeture')
  })

  it('no schedule: « Aucun horaire d\'ouverture », and no invented instant or zone', async () => {
    const status = lockerStatus({ currentWindow: { timeZone: null, open: false, closesAt: null, nextOpensAt: null } })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(status)] }))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    const text = plain(panel().textContent)
    expect(text).toContain("Aucun horaire d'ouverture")
    expect(text).not.toMatch(/Fermeture|Prochaine ouverture|Fuseau du casier|Ouvert\b/)
  })
})

describe('Casiers — loading and failures', () => {
  it('loading: a status message and a skeleton, then the announcement of the connection state', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [async () => (await gate, ok(lockerStatus()))] }))
    await waitFor(() => expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain('Chargement du statut du casier…'))
    expect(document.querySelector('.ag-skel__bar')).not.toBeNull()
    act(() => release())
    await waitFor(() => expect(screen.getAllByRole('status').map((status) => plain(status.textContent))).toContain('Casier AEGIS-DEMO-01 : En ligne.'))
    expect(document.querySelector('.ag-skel__bar')).toBeNull()
  })

  it('404: says the locker is not found and offers no retry', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [failure(404, 'RESOURCE_NOT_FOUND')] }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Casier introuvable.')
    expect(within(alert).queryByRole('button')).toBeNull()
  })

  it('403: says the account has no access', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [failure(403, 'FORBIDDEN')] }))
    expect((await screen.findByRole('alert')).textContent).toContain("Votre compte n'a pas accès au statut des casiers.")
  })

  it('network error before any data: a warning with a retry that loads the status', async () => {
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [offline] })
    renderLockers(gateway)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Connexion au service impossible.')
    gateway.getStatus.mockResolvedValueOnce(ok(lockerStatus()))
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { level: 2, name: SECTION })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a malformed 2xx body is a service error with the trace id, never a guessed state', async () => {
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [{ kind: 'invalidResponse', status: 200, requestId: 'req-bad-body' }] }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Le service n'a pas pu fournir ces données.")
    expect(alert.textContent).toContain('req-bad-body')
    expect(document.body.textContent).not.toMatch(/En ligne|Hors ligne/)
  })

  it.each([
    ['AUTH_TOKEN_EXPIRED', 'Votre session a expiré. Reconnectez-vous.'],
    ['AUTH_TOKEN_INVALID', "Votre session n'est plus valide. Reconnectez-vous."],
  ])('401 %s returns to sign-in through the session handling', async (code, title) => {
    const { session } = renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [failure(401, code)] }))
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(session.getAccessToken()).toBeNull()
    expect(document.querySelector('.ag-alert[role="status"]')?.textContent).toContain(title)
  })

  it('without a session the page is not shown and the sign-in page takes over', async () => {
    window.history.replaceState(null, '', '/casiers')
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    renderWithProviders(<App />, { gateway: authGateway, lockerGateway: gateway })
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(gateway.getStatus).not.toHaveBeenCalled()
  })
})

describe('Casiers — focus never falls to the body', () => {
  it('after « Réessayer » in the first-load alert, while the retry runs and after it answers', async () => {
    let answer: (value: ReturnType<typeof ok>) => void = () => {}
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [offline] })
    renderLockers(gateway)
    const alert = await screen.findByRole('alert')
    gateway.getStatus.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Réessayer' }))
    // The button is gone (the skeleton replaced the alert): the panel holds focus.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Statut du casier' }))
    await act(async () => answer(ok(lockerStatus())))
    await screen.findByRole('heading', { level: 2, name: SECTION })
    expect(document.activeElement).not.toBe(document.body)
  })

  it('after a retry of the stale notice that is answered 404 or 403, the panel holds focus', async () => {
    for (const [status, code] of [[404, 'RESOURCE_NOT_FOUND'], [403, 'FORBIDDEN']] as const) {
      const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
      const { queryClient, unmount } = renderLockers(gateway)
      await screen.findByRole('heading', { level: 2, name: SECTION })
      gateway.getStatus.mockResolvedValue(offline)
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: queryKeys.lockers.status(DEMO_LOCKER_ID) })
      })
      const notice = await within(panel()).findByRole('alert')
      gateway.getStatus.mockResolvedValueOnce(failure(status, code))
      await userEvent.setup().click(within(notice).getByRole('button', { name: 'Réessayer' }))
      await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
      expect(screen.getByRole('alert')).toBeDefined()
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Statut du casier' }))
      unmount()
    }
  })

  it('after « Réessayer » in the catalog alert, the page holds focus while the catalog loads', async () => {
    const catalogGateway = fakeCatalogGateway({ pages: [offline] })
    renderLockers(fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] }), { catalogGateway })
    const alert = await screen.findByRole('alert')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    catalogGateway.listAssets.mockImplementationOnce(async () => (await gate, catalogOk(pageOf([PLACED]))))
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('main'))
    act(() => release())
    expect(await screen.findByRole('heading', { level: 2, name: SECTION })).toBeDefined()
  })
})

describe('Casiers — stale data and refresh', () => {
  async function renderLoaded(locale: Locale = 'fr') {
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
    const view = renderLockers(gateway, { locale })
    await screen.findByRole('heading', { level: 2, name: /AEGIS-DEMO-01/ })
    return { gateway, ...view }
  }
  const refresh = (queryClient: { refetchQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> }) =>
    act(async () => {
      await queryClient.refetchQueries({ queryKey: queryKeys.lockers.status(DEMO_LOCKER_ID) })
    })

  it('keeps the last good data, says it is not up to date, and retries', async () => {
    const { gateway, queryClient } = await renderLoaded()
    expect(within(panel()).queryByRole('alert')).toBeNull()
    gateway.getStatus.mockResolvedValue(offline)
    await refresh(queryClient)

    const notice = await within(panel()).findByRole('alert')
    expect(notice.textContent).toContain('Données non actualisées.')
    expect(plain(notice.textContent)).toMatch(/évaluées à .*\d/)
    // The last good state stays on screen, with its table; nothing is blanked.
    expect(screen.getByRole('heading', { level: 2, name: SECTION })).toBeDefined()
    expect(within(panel()).getByRole('table')).toBeDefined()
    expect(plain(panel().textContent)).toContain('En ligne')

    gateway.getStatus.mockResolvedValueOnce(ok(lockerStatus({ connectionStatus: 'OFFLINE' })))
    await userEvent.setup().click(within(notice).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(within(panel()).queryByRole('alert')).toBeNull())
    expect(plain(panel().textContent)).toContain('Hors ligne')
    // The button that had focus is gone: focus moves to the locker title, not to the page body.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: SECTION }))
  })

  it('a refresh answered 404 shows the refusal instead of stale data', async () => {
    const { gateway, queryClient } = await renderLoaded()
    gateway.getStatus.mockResolvedValue(failure(404, 'RESOURCE_NOT_FOUND'))
    await refresh(queryClient)
    expect((await screen.findByRole('alert')).textContent).toContain('Casier introuvable.')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('announces the connection state once and again only when it changes', async () => {
    const { gateway, queryClient } = await renderLoaded()
    const announcement = () => screen.getAllByRole('status').map((status) => plain(status.textContent)).filter((text) => text.startsWith('Casier '))
    expect(announcement()).toEqual(['Casier AEGIS-DEMO-01 : En ligne.'])

    // A refresh that changes nothing leaves the live region's text untouched: nothing new to read.
    const region = screen.getAllByRole('status').find((status) => status.textContent?.startsWith('Casier '))
    const before = region?.textContent
    gateway.getStatus.mockResolvedValue(ok(lockerStatus({ evaluatedAt: '2026-11-03T15:00:15Z' })))
    await refresh(queryClient)
    expect(region?.textContent).toBe(before)

    gateway.getStatus.mockResolvedValue(ok(OFFLINE))
    await refresh(queryClient)
    await waitFor(() => expect(announcement()).toEqual(['Casier AEGIS-DEMO-01 : Hors ligne.']))
  })

  it('asks again on a modest interval, and only to read', async () => {
    expect(LOCKER_STATUS_REFRESH_MS).toBeGreaterThanOrEqual(10_000)
    expect(LOCKER_STATUS_REFRESH_MS).toBeLessThanOrEqual(30_000)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const gateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus()), ok(OFFLINE)] })
    renderLockers(gateway)
    await screen.findByRole('heading', { level: 2, name: /AEGIS-DEMO-01/ })
    expect(gateway.getStatus).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCKER_STATUS_REFRESH_MS + 100)
    })
    await waitFor(() => expect(gateway.getStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(plain(panel().textContent)).toContain('Hors ligne'))
  })
})
