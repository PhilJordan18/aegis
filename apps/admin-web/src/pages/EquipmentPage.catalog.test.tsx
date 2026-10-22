import { act, cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { CatalogGateway } from '../features/catalog/catalogGateway'
import type { AdminAssetView } from '../features/catalog/contract'
import { parseAdminAssetView } from '../features/catalog/contractParsers'
import { asset, fakeCatalogGateway, MM001, MM002, ok, pageOf } from '../features/catalog/testFixtures'
import type { Locale } from '../i18n/locale'
import { MESSAGES } from '../i18n/messages'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')

function renderEquipment(catalogGateway: CatalogGateway, { locale = 'fr', url = '/equipements' }: { locale?: Locale; url?: string } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, catalogGateway, session, queryClient, locale })
}

/** The unit links of the list panel (the sidebar and the diagnostic reasons are lists too). */
const rows = () => within(document.querySelector('.ag-list__items') as HTMLElement).getAllByRole('link')

const failure = (status: number, code: string, traceId = 'trace-0001') =>
  ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId }), retryAfter: null, requestId: 'req-x' }) as const

// Rendering a whole page per test is slower when the suites run in parallel.
configure({ asyncUtilTimeout: 4000 })

beforeEach(() => {
  installMatchMedia(window, false)
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('Équipements — list and dossier from the catalog API', () => {
  it('shows the units, selects the first one and reads it from the API with the session token', async () => {
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001, MM002]))], units: { [MM001.id]: ok(MM001) } })
    renderEquipment(gateway)

    expect(await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })).toBeDefined()
    const links = rows()
    expect(links).toHaveLength(2)
    expect(plain(links[0]?.textContent)).toContain('Multimètre 1MM-001')
    expect(links[0]?.getAttribute('aria-current')).toBe('true')
    expect(links[1]?.getAttribute('aria-current')).toBeNull()

    expect(gateway.listAssets).toHaveBeenCalledTimes(1)
    expect(gateway.listAssets.mock.calls[0]?.[0]).toBe('token-value')
    expect(gateway.listAssets.mock.calls[0]?.[1]).toEqual({ page: 0, size: 20, sort: 'assetCode,asc' })
    await waitFor(() => expect(gateway.getAsset).toHaveBeenCalledWith('token-value', MM001.id, expect.anything()))
    expect(await screen.findByRole('heading', { level: 2, name: /Multimètre 1 · MM-001/ })).toBeDefined()
  })

  it('invents no readiness and no presence: an empty-looking unit is « unknown », not « Prêt »', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM001.id]: ok(MM001) } }))
    await screen.findByRole('heading', { level: 2, name: /Multimètre 1 · MM-001/ })
    const text = plain(document.body.textContent)
    expect(text).not.toMatch(/\bPrêt\b|\bReady\b|READY/)
    expect(text).toContain('État physique inconnu')
    expect(text).toContain('Présence inconnue')
    expect(text).toContain('Aucun placement connu')
    expect(text).toContain('Aucune observation de présence')
    expect(text).not.toMatch(/Présent dans|AEGIS-DEMO/)
  })

  it('says since when a calibration expired and counts blockers', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([MM002]))], units: { [MM002.id]: ok(MM002) } }))
    await screen.findByRole('heading', { level: 2, name: /Multimètre 2 · MM-002/ })
    const dossier = screen.getByRole('group', { name: /Multimètre 2/ })
    expect(plain(dossier.textContent)).toContain('2 empêchements')
    expect(plain(dossier.textContent)).toContain('Calibration expirée depuis le 8 sept. 2026')
    expect(plain(dossier.textContent)).toContain('Fuseau du laboratoire : America/Toronto')
  })

  it('marks an archived unit and keeps it in the list', async () => {
    const archived = asset({ id: '9b7e4d2c-3c8a-4f6b-a1d0-2e5f8c7b6a03', assetCode: 'MM-009', archivedAt: '2026-10-03T15:00:00Z', availability: 'UNAVAILABLE', operationalDiagnostic: { evaluatedAt: '2026-10-21T14:30:00Z', reasons: ['NOT_AVAILABLE', 'UNKNOWN_PHYSICAL_STATE'] } })
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([archived]))], units: { [archived.id]: ok(archived) } }))
    expect(await screen.findByText('Archivé')).toBeDefined()
    await waitFor(() => expect(plain(document.body.textContent)).toContain('Archivé le 3 oct. 2026'))
  })

  it('selects a row by link: the address keeps the unit, the dossier changes, and the change is announced', async () => {
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001, MM002]))], units: { [MM001.id]: ok(MM001), [MM002.id]: ok(MM002) } })
    renderEquipment(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })
    const user = userEvent.setup()
    const second = rows()[1] as HTMLElement
    await user.click(second)
    expect(window.location.search).toBe(`?exemplaire=${MM002.id}`)
    expect(second.getAttribute('aria-current')).toBe('true')
    expect(await screen.findByRole('heading', { level: 2, name: /Multimètre 2 · MM-002/ })).toBeDefined()
    expect(plain(document.querySelectorAll('[role="status"]')[1]?.textContent)).toBe('Exemplaire sélectionné : Multimètre 2, MM-002.')
    expect(gateway.getAsset).toHaveBeenCalledWith('token-value', MM002.id, expect.anything())
  })

  it('reads a unit named in the address, even when it is not in the shown page', async () => {
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM002.id]: ok(MM002) } })
    renderEquipment(gateway, { url: `/equipements?exemplaire=${MM002.id}` })
    expect(await screen.findByRole('heading', { level: 2, name: /Multimètre 2 · MM-002/ })).toBeDefined()
    expect(rows().map((link) => link.getAttribute('aria-current'))).toEqual([null])
  })

  it('ignores a unit id that is not a UUID instead of putting it in a request path', async () => {
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM001.id]: ok(MM001) } })
    renderEquipment(gateway, { url: '/equipements?exemplaire=../auth/me' })
    await screen.findByRole('heading', { level: 2, name: /Multimètre 1 · MM-001/ })
    expect(gateway.getAsset.mock.calls.every((call) => call[1] === MM001.id)).toBe(true)
  })

  it('shows the loading state with a status message, then announces the loaded list', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const gateway = fakeCatalogGateway({ pages: [async () => (await gate, ok(pageOf([MM001])))], units: { [MM001.id]: ok(MM001) } })
    renderEquipment(gateway)
    expect(screen.getAllByRole('status')[0]?.textContent).toBe('Chargement des exemplaires…')
    expect(document.querySelector('.ag-skel')).not.toBeNull()
    act(() => release())
    await waitFor(() => expect(plain(screen.getAllByRole('status')[0]?.textContent)).toBe('Liste chargée : 1 exemplaire, page 1 sur 1.'))
    expect(document.querySelector('.ag-skel')).toBeNull()
  })

  it('shows an empty catalog without a dossier', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([]))] }))
    expect(await screen.findByText('Aucun exemplaire.')).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: '0 exemplaire' })).toBeDefined()
    expect(screen.queryByRole('group', { name: /·/ })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Pagination des exemplaires' })).toBeNull()
  })
})

describe('Équipements — pagination', () => {
  const many = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => asset({ id: `00000000-0000-4000-8000-${String(start + index).padStart(12, '0')}`, assetCode: `MM-${String(start + index).padStart(3, '0')}` }))

  it('moves between pages through the address and resets the selection', async () => {
    const first = many(1, 20)
    const second = many(21, 5)
    const gateway = fakeCatalogGateway({
      pages: [ok(pageOf(first, { totalItems: 25, totalPages: 2 })), ok(pageOf(second, { page: 1, totalItems: 25, totalPages: 2 }))],
      units: Object.fromEntries([...first, ...second].map((unit) => [unit.id, ok(unit)])),
    })
    renderEquipment(gateway)
    const pager = await screen.findByRole('navigation', { name: 'Pagination des exemplaires' })
    expect(within(pager).getByText('Page 1 sur 2')).toBeDefined()
    expect(within(pager).getByRole('button', { name: 'Précédent' }).getAttribute('aria-disabled')).toBe('true')
    const user = userEvent.setup()
    await user.click(within(pager).getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(window.location.search).toBe('?page=2'))
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Pagination des exemplaires' })).getByText('Page 2 sur 2')).toBeDefined())
    expect(gateway.listAssets.mock.calls.map((call) => call[1].page)).toEqual([0, 1])
    expect(rows()).toHaveLength(5)
    const next = screen.getByRole('button', { name: 'Suivant' })
    expect(next.getAttribute('aria-disabled')).toBe('true')
  })

  it('brings a page past the end back to the last page that exists', async () => {
    const only = many(1, 3)
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf(only, { totalItems: 3, totalPages: 1 })), ok(pageOf([], { page: 4, totalItems: 3, totalPages: 1 }))], units: {} })
    gateway.listAssets.mockImplementation(async (_token: string, query: { page: number }) => (query.page === 0 ? ok(pageOf(only, { totalItems: 3, totalPages: 1 })) : ok(pageOf([], { page: query.page, totalItems: 3, totalPages: 1 }))))
    renderEquipment(gateway, { url: '/equipements?page=5' })
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})

describe('Équipements — adverse states', () => {
  it('network failure: a warning with a way to try again, which reloads the list', async () => {
    const gateway = fakeCatalogGateway({ pages: [{ kind: 'network', reason: 'offline' }] })
    renderEquipment(gateway)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Connexion au service impossible.')
    gateway.listAssets.mockResolvedValueOnce(ok(pageOf([MM001])))
    gateway.getAsset.mockResolvedValue(ok(MM001))
    const user = userEvent.setup()
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { level: 2, name: '1 exemplaire' })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('5xx with a problem body: an error with the trace ID label and value, and never the server detail', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [failure(500, 'INTERNAL_ERROR', 'trace-4242')] }))
    const alert = await screen.findByRole('alert')
    expect(plain(alert.textContent)).toContain("Le service n'a pas pu fournir ces données.")
    expect(plain(alert.textContent)).toContain('Identifiant de suivi : trace-4242')
    expect(alert.textContent).not.toContain('Test detail')
  })

  it('a gateway answer without a problem body is reported as unreachable', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [{ kind: 'httpProblem', status: 502, problem: null, retryAfter: null, requestId: null }] }))
    expect((await screen.findByRole('alert')).textContent).toContain('Connexion au service impossible.')
  })

  it('a 2xx body that breaks the contract is a service error', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [{ kind: 'invalidResponse', status: 200, requestId: 'req-77' }] }))
    expect(plain((await screen.findByRole('alert')).textContent)).toContain('Identifiant de suivi : req-77')
  })

  it('403: access refused, no retry, no data and no dossier', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [failure(403, 'FORBIDDEN')] }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Votre compte n'a pas accès aux équipements.")
    expect(within(alert).queryByRole('button')).toBeNull()
    expect(document.querySelector('.ag-list__items')).toBeNull()
    expect(screen.queryByRole('group', { name: /·/ })).toBeNull()
  })

  it.each([
    ['AUTH_TOKEN_EXPIRED', 'Votre session a expiré. Reconnectez-vous.'],
    ['AUTH_TOKEN_INVALID', "Votre session n'est plus valide. Reconnectez-vous."],
  ])('401 %s returns to sign-in through the session handling', async (code, title) => {
    const { session } = renderEquipment(fakeCatalogGateway({ pages: [failure(401, code)] }))
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(session.getAccessToken()).toBeNull()
    expect(document.querySelector('.ag-alert[role="status"]')?.textContent).toContain(title)
  })

  it('a unit that is gone (404) says so in the dossier and offers the way back to the list', async () => {
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM002.id]: failure(404, 'RESOURCE_NOT_FOUND') } })
    renderEquipment(gateway, { url: `/equipements?exemplaire=${MM002.id}` })
    expect(await screen.findByText('Exemplaire introuvable.')).toBeDefined()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retour à la liste' }))
    expect(window.location.search).toBe('')
  })

  it('a failed refresh keeps the data on screen and says it is not up to date', async () => {
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM001.id]: ok(MM001) } })
    const { queryClient } = renderEquipment(gateway)
    await screen.findByRole('heading', { level: 2, name: '1 exemplaire' })
    gateway.listAssets.mockResolvedValue({ kind: 'network', reason: 'offline' })
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['catalog', 'assets', 'list'] })
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Données non actualisées.')
    expect(plain(alert.textContent)).toMatch(/évaluées à .*\d/)
    expect(rows()).toHaveLength(1)
  })
})

describe.each<Locale>(['fr', 'en'])('Équipements in %s', (locale) => {
  const m = MESSAGES[locale]

  it('uses the catalog for every label and shows no key path', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([MM001, MM002]))], units: { [MM001.id]: ok(MM001), [MM002.id]: ok(MM002) } }), { locale })
    await screen.findByRole('heading', { level: 2, name: plain(m.equipment.listTitle({ count: 2 })) })
    await waitFor(() => expect(plain(document.body.textContent)).toContain(plain(m.equipment.unknownNote)))
    const text = plain(document.body.textContent)
    expect(text).toContain(plain(m.equipment.reason.UNKNOWN_PHYSICAL_STATE))
    expect(text).toContain(plain(m.equipment.presenceInline.UNKNOWN))
    expect(text).toContain(plain(m.equipment.noPlacement))
    expect(text).toContain(plain(m.equipment.calibrationExpiredOn({ date: locale === 'fr' ? '8 sept. 2026' : 'Sep 8, 2026' })))
    expect(text).not.toMatch(/\b(equipment|shell)\.[a-zA-Z]+/)
    expect(screen.getByRole('navigation', { name: m.equipment.viewsLabel })).toBeDefined()
    if (locale === 'en') expect(text).not.toMatch(/Exemplaire|empêchement|Présence|Disponible/)
  })
})

describe('Équipements — unknown enumeration values (09 §3)', () => {
  it('renders the page with one unit in an unavailable state, and the other units untouched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const odd = { ...MM002, operationalStatus: 'RETIRED', operationalDiagnostic: { evaluatedAt: MM002.operationalDiagnostic.evaluatedAt, reasons: ['QUARANTINED', 'UNKNOWN_PHYSICAL_STATE'] } }
    // Through the real parser, as the HTTP gateway would deliver it.
    const parsedOdd = parseAdminAssetView(JSON.parse(JSON.stringify(odd))) as AdminAssetView
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001, parsedOdd]))], units: { [MM001.id]: ok(MM001), [MM002.id]: ok(parsedOdd) } })
    renderEquipment(gateway, { url: `/equipements?exemplaire=${MM002.id}` })
    const dossier = await screen.findByRole('group', { name: /Multimètre 2/ })
    expect(plain(dossier.textContent)).toContain('État indisponible')
    expect(plain(dossier.textContent)).toContain('Une valeur envoyée par le serveur')
    expect(plain(dossier.textContent)).not.toContain('RETIRED')
    expect(plain(dossier.textContent)).not.toContain('QUARANTINED')
    expect(rows()).toHaveLength(2)
    expect(plain(rows()[0]?.textContent)).toContain('Multimètre 1MM-001')
    expect(warn).toHaveBeenCalled()
  })
})

describe('Équipements — read-only', () => {
  it('offers no control that creates, edits, archives or saves', async () => {
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM001.id]: ok(MM001) } }))
    await screen.findByRole('heading', { level: 2, name: /Multimètre 1 · MM-001/ })
    const main = screen.getByRole('main')
    expect(within(main).queryAllByRole('button')).toEqual([])
    expect(within(main).queryAllByRole('textbox')).toEqual([])
    expect(within(main).queryAllByRole('combobox')).toEqual([])
    expect(plain(main.textContent)).not.toMatch(/Nouvel équipement|Enregistrer/)
  })
})

