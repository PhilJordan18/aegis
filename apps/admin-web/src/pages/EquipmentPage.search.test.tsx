import { cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile } from '../features/auth/testFixtures'
import type { CatalogGateway } from '../features/catalog/catalogGateway'
import type { AdminAssetPage, AssetListQuery } from '../features/catalog/contract'
import { fakeCatalogGateway, MM001, MM002, ok, pageOf } from '../features/catalog/testFixtures'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')

configure({ asyncUtilTimeout: 4000 })
beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

/** Answers every list request; a search finds MM-002 only, or nothing for « absent ». */
function searchGateway(): ReturnType<typeof fakeCatalogGateway> {
  const answer = (query: AssetListQuery): AdminAssetPage =>
    query.q === undefined ? pageOf([MM001, MM002]) : query.q === 'absent' ? pageOf([]) : pageOf([MM002], { totalItems: 1 })
  return fakeCatalogGateway({
    units: { [MM001.id]: ok(MM001), [MM002.id]: ok(MM002) },
    overrides: { listAssets: async (_token, query) => ok(answer(query)) },
  })
}

function renderEquipment(catalogGateway: CatalogGateway, { locale = 'fr', url = '/equipements' }: { locale?: Locale; url?: string } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, catalogGateway, session, queryClient, locale })
}

const queries = (gateway: ReturnType<typeof fakeCatalogGateway>) => gateway.listAssets.mock.calls.map((call) => call[1])
const box = () => screen.getByRole('searchbox', { name: 'Rechercher un exemplaire' })

describe('Équipements — search (09 §22.3, #109)', () => {
  it('sends the trimmed text as q from the first page, keeps it in the address, and lists what matches', async () => {
    const user = userEvent.setup()
    const gateway = searchGateway()
    renderEquipment(gateway, { url: '/equipements?page=1' })
    await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })
    expect(queries(gateway)[0]).not.toHaveProperty('q')

    await user.type(box(), '\u00A0 clé  à molette ')
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await screen.findByRole('heading', { level: 2, name: '1 exemplaire' })
    expect(queries(gateway).at(-1)).toEqual({ page: 0, size: 20, sort: 'assetCode,asc', q: 'clé  à molette' })
    expect(new URLSearchParams(window.location.search).get('recherche')).toBe('clé  à molette')
    // The unit links keep the search, so a selection does not drop it.
    const row = screen.getByRole('link', { name: /MM-002/ })
    expect(new URL(row.getAttribute('href') ?? '', 'http://aegis.test').searchParams.get('recherche')).toBe('clé  à molette')
  })

  it('sends 100 ZWJ emoji whole, and refuses 101 on the field without any request', async () => {
    const user = userEvent.setup()
    const gateway = searchGateway()
    renderEquipment(gateway)
    await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })
    const zwj = '\u{1F469}‍\u{1F527}'

    fireEvent.change(box(), { target: { value: zwj.repeat(101) } })
    const before = gateway.listAssets.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText('La recherche compte au plus 100 caractères.')).toBeDefined()
    expect(box().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(box())
    // Nothing was cut: the field still holds all 101.
    expect((box() as HTMLInputElement).value).toBe(zwj.repeat(101))
    expect(gateway.listAssets.mock.calls.length).toBe(before)

    fireEvent.change(box(), { target: { value: zwj.repeat(100) } })
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() => expect(queries(gateway).at(-1)?.q).toBe(zwj.repeat(100)))
    expect(screen.queryByText('La recherche compte au plus 100 caractères.')).toBeNull()
  })

  it('refuses a control character, and treats a search of spaces only as no filter', async () => {
    const user = userEvent.setup()
    const gateway = searchGateway()
    renderEquipment(gateway, { url: '/equipements?recherche=MM' })
    await screen.findByRole('heading', { level: 2, name: '1 exemplaire' })

    fireEvent.change(box(), { target: { value: 'a\tb' } })
    const before = gateway.listAssets.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText(/La recherche contient un caractère non autorisé/)).toBeDefined()
    expect(gateway.listAssets.mock.calls.length).toBe(before)

    fireEvent.change(box(), { target: { value: ' \u00A0\u202F\u3000' } })
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })
    expect(queries(gateway).at(-1)).not.toHaveProperty('q')
    expect(window.location.search).toBe('')
  })

  it('says when nothing matches, and « Tout afficher » lists every unit again', async () => {
    const user = userEvent.setup()
    const gateway = searchGateway()
    renderEquipment(gateway, { url: '/equipements?recherche=absent' })
    expect(plain((await screen.findByText(/Aucun exemplaire ne correspond/)).textContent)).toBe('Aucun exemplaire ne correspond à « absent ».')
    expect(queries(gateway)[0]?.q).toBe('absent')
    expect((box() as HTMLInputElement).value).toBe('absent')
    await user.click(screen.getByRole('button', { name: 'Tout afficher' }))
    await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })
    expect((box() as HTMLInputElement).value).toBe('')
  })

  it('filters nothing for an unusable search in the address, and says why', async () => {
    const gateway = searchGateway()
    renderEquipment(gateway, { url: `/equipements?recherche=${encodeURIComponent('a\nb')}` })
    await screen.findByRole('heading', { level: 2, name: '2 exemplaires' })
    expect(queries(gateway).every((query) => query.q === undefined)).toBe(true)
    expect(screen.getByText(/La recherche contient un caractère non autorisé/)).toBeDefined()
  })

  it('keeps the search when paging', async () => {
    const user = userEvent.setup()
    const gateway = fakeCatalogGateway({
      units: { [MM001.id]: ok(MM001), [MM002.id]: ok(MM002) },
      overrides: { listAssets: async (_token, query) => ok(pageOf(query.page === 0 ? [MM001] : [MM002], { page: query.page, totalItems: 21, totalPages: 2 })) },
    })
    renderEquipment(gateway, { url: '/equipements?recherche=MM' })
    await screen.findByRole('heading', { level: 2, name: '21 exemplaires' })
    await user.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(queries(gateway).at(-1)).toMatchObject({ page: 1, q: 'MM' }))
  })

  it('speaks English', async () => {
    const user = userEvent.setup()
    const gateway = searchGateway()
    renderEquipment(gateway, { locale: 'en', url: '/equipements?recherche=absent' })
    expect(await screen.findByText('No unit matches “absent”.')).toBeDefined()
    const field = screen.getByRole('searchbox', { name: 'Search units' })
    fireEvent.change(field, { target: { value: 'x'.repeat(101) } })
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('A search has at most 100 characters.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Show all' })).toBeDefined()
  })
})
