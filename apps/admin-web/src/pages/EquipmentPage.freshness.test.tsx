import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient, READ_STALE_MS } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, sessionStubs } from '../features/auth/testFixtures'
import type { AdminAssetView } from '../features/catalog/contract'
import { asset, fakeCatalogGateway, FLUKE_117, MM001, modelPageOf, ok, pageOf } from '../features/catalog/testFixtures'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

configure({ asyncUtilTimeout: 4000 })

/**
 * #197. Reproduced on a real stack: a technician reserved, cancelled, checked out and returned a unit while the
 * Manager stayed on Équipements, and the list and the dossier kept « Disponible » (then « Réservé », « Emprunté ») for
 * as long as a screen was re-entered within 30 s or the tab came back within 30 s. The server's answer is the only
 * truth, so the screen must ask again when it is entered or comes back, not trust a read of 30 s ago.
 */
const authGateway: AuthGateway = { ...unconfiguredAuthGateway, ...sessionStubs, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const available = MM001
const reserved: AdminAssetView = asset({ id: MM001.id, assetCode: 'MM-001', serialNumber: 'FL-117-0042', availability: 'RESERVED' })

/** What the server says now; the test changes it between two reads, as a technician does. */
function server() {
  let current: AdminAssetView = available
  const gateway = fakeCatalogGateway({
    pages: [async () => ok(pageOf([current]))],
    units: { [MM001.id]: async () => ok(current) },
    modelPages: [ok(modelPageOf([FLUKE_117]))],
  })
  return { gateway, set: (next: AdminAssetView) => (current = next) }
}

function renderEquipment(gateway: ReturnType<typeof server>['gateway']) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', '/equipements')
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, catalogGateway: gateway, session, queryClient })
}

const row = () => plain((document.querySelector('.ag-list__items') as HTMLElement).textContent)
const dossierFacts = () => plain(document.querySelector('.ag-dossier')?.textContent)
const tabBack = () => document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
/** Time passes for the cache (its staleness reads `Date.now()`); the timers of the page stay real. */
const later = (ms: number) => vi.setSystemTime(Date.now() + ms)

beforeEach(() => {
  installMatchMedia(window, false)
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('Équipements shows what the server says now', () => {
  it('reads the list and the dossier again when the tab comes back after the read went stale', async () => {
    const { gateway, set } = server()
    renderEquipment(gateway)
    await waitFor(() => expect(row()).toContain('Disponible'))
    await waitFor(() => expect(dossierFacts()).toContain('Disponible'))
    expect(gateway.listAssets).toHaveBeenCalledTimes(1)

    set(reserved)
    later(READ_STALE_MS + 1_000)
    tabBack()
    await waitFor(() => expect(row()).toContain('Réservé'))
    await waitFor(() => expect(dossierFacts()).toContain('Réservé'))
    expect(gateway.listAssets).toHaveBeenCalledTimes(2)
    expect(gateway.getAsset).toHaveBeenCalledTimes(2)
  })

  it('does not read twice for a tab that flickers: a read a moment old is shared', async () => {
    const { gateway } = server()
    renderEquipment(gateway)
    await waitFor(() => expect(row()).toContain('Disponible'))
    await waitFor(() => expect(gateway.getAsset).toHaveBeenCalledTimes(1))
    later(READ_STALE_MS - 2_000)
    tabBack()
    tabBack()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(gateway.listAssets).toHaveBeenCalledTimes(1)
    expect(gateway.getAsset).toHaveBeenCalledTimes(1)
  })

  it('reads the list again when the units view is entered after the read went stale, and not before', async () => {
    const user = userEvent.setup()
    const { gateway, set } = server()
    renderEquipment(gateway)
    await waitFor(() => expect(row()).toContain('Disponible'))

    // Away and back at once: nothing is asked again.
    await user.click(screen.getByRole('link', { name: 'Modèles' }))
    await screen.findByRole('heading', { level: 2, name: /modèle/ })
    await user.click(screen.getByRole('link', { name: 'Exemplaires' }))
    await waitFor(() => expect(row()).toContain('Disponible'))
    expect(gateway.listAssets).toHaveBeenCalledTimes(1)

    // Away, a reservation elsewhere, and back after the read went stale.
    await user.click(screen.getByRole('link', { name: 'Modèles' }))
    await screen.findByRole('heading', { level: 2, name: /modèle/ })
    set(reserved)
    later(READ_STALE_MS + 1_000)
    await user.click(screen.getByRole('link', { name: 'Exemplaires' }))
    await waitFor(() => expect(row()).toContain('Réservé'))
    expect(gateway.listAssets).toHaveBeenCalledTimes(2)
  })
})

describe('« Actualiser » on Équipements', () => {
  it('reads the list and the open dossier now, says so, and is busy while it reads', async () => {
    const user = userEvent.setup()
    const { gateway, set } = server()
    renderEquipment(gateway)
    await waitFor(() => expect(dossierFacts()).toContain('Disponible'))
    const main = screen.getByRole('main')
    const button = within(main).getByRole('button', { name: 'Actualiser' })

    // Within the trust window: only the button asks, and it asks for both reads.
    set(reserved)
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    gateway.listAssets.mockImplementationOnce(async () => {
      await held
      return ok(pageOf([reserved]))
    })
    await user.click(button)
    await waitFor(() => expect(button.className).toContain('is-busy'))
    expect(gateway.getAsset).toHaveBeenCalledTimes(2)
    release()
    await waitFor(() => expect(row()).toContain('Réservé'))
    await waitFor(() => expect(dossierFacts()).toContain('Réservé'))
    await waitFor(() => expect(button.className).not.toContain('is-busy'))
    expect(plain(within(main).getAllByRole('status').map((status) => status.textContent).join(' '))).toContain('Liste chargée : 1 exemplaire, page 1 sur 1.')
  })

  it('is not offered on the models view', async () => {
    const user = userEvent.setup()
    renderEquipment(server().gateway)
    await screen.findByRole('button', { name: 'Actualiser' })
    await user.click(screen.getByRole('link', { name: 'Modèles' }))
    await screen.findByRole('heading', { level: 2, name: /modèle/ })
    expect(screen.queryByRole('button', { name: 'Actualiser' })).toBeNull()
  })
})
