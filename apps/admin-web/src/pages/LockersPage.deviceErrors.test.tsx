import { cleanup, configure, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile } from '../features/auth/testFixtures'
import { MM001, fakeCatalogGateway, ok as catalogOk, pageOf } from '../features/catalog/testFixtures'
import type { DeviceError, LockerStatus } from '../features/lockers/contract'
import { A1, A2, DEMO_LOCKER_ID, fakeLockerGateway, lockerStatus, NEVER_SEEN, OFFLINE, ok } from '../features/lockers/testFixtures'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

/** #29: the errors the hub reported in its current session (09 §8.6), read-only beside the connection state. */
const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const PLACED = { ...MM001, placement: { lockerId: DEMO_LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1.id, compartmentCode: 'A1' } }

function renderLocker(status: LockerStatus, locale: Locale = 'fr') {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', '/casiers')
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const lockerGateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(status)] })
  const catalogGateway = fakeCatalogGateway({ pages: [catalogOk(pageOf([PLACED]))] })
  renderWithProviders(<App />, { gateway: authGateway, catalogGateway, lockerGateway, session, queryClient, locale })
  return lockerGateway
}

const error = (overrides: Partial<DeviceError> = {}): DeviceError => ({
  errorCode: 'RFID_READER_FAULT',
  severity: 'CRITICAL',
  compartmentId: A2.id,
  firstReceivedAt: '2026-11-03T14:10:00Z',
  lastReceivedAt: '2026-11-03T14:50:00Z',
  occurrences: 3,
  ...overrides,
})

/** Two groups as the server orders them: CRITICAL first, then the latest. */
const TWO = [
  error(),
  error({ errorCode: 'INBOUND_MESSAGE_INVALID', severity: 'WARNING', compartmentId: null, firstReceivedAt: '2026-11-03T14:55:00Z', lastReceivedAt: '2026-11-03T14:55:00Z', occurrences: 1 }),
]

const errorsSection = async (name: RegExp) => {
  await screen.findByRole('heading', { level: 2, name: /AEGIS-DEMO-01/ })
  return screen.getByRole('region', { name }) as HTMLElement
}

configure({ asyncUtilTimeout: 4000 })
beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('Casiers — reported device errors (#29, 09 §8.6)', () => {
  it('lists each group in the server order with its severity, code, place, count and reception times', async () => {
    renderLocker(lockerStatus({ deviceErrors: TWO }))
    const section = await errorsSection(/^2 erreurs signalées/)
    expect(plain(section.textContent)).toContain("Une erreur signalée n'est pas forcément une panne en cours")
    const items = within(section).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const first = plain(items[0]?.textContent)
    expect(first).toMatch(/^CritiqueDéfaut du lecteur RFIDRFID_READER_FAULT · Cellule A2 · 3 signalements/)
    expect(first).toMatch(/Dernière réception : 3 nov\. 2026, \d+ h 50 [A-Z]+/)
    expect(first).toMatch(/Première réception : 3 nov\. 2026, \d+ h 10 [A-Z]+/)
    const second = plain(items[1]?.textContent)
    expect(second).toMatch(/^AvertissementMessage reçu invalideINBOUND_MESSAGE_INVALID · Casier entier · 1 signalement/)
    expect(second).toMatch(/Reçue : 3 nov\. 2026, \d+ h 55 [A-Z]+$/)
    expect(second).not.toContain('Première réception')
  })

  it('never changes the connection state, a compartment state or an action because of an error', async () => {
    const gateway = renderLocker(lockerStatus({ deviceErrors: [error({ errorCode: 'LOCK_ACTUATOR_FAULT', compartmentId: A1.id })] }))
    await errorsSection(/^1 erreur signalée/)
    const panel = screen.getByRole('region', { name: /Casier de démonstration du laboratoire · AEGIS-DEMO-01/ })
    expect(plain(panel.textContent)).toContain('En ligne')
    const rows = within(within(panel).getByRole('table')).getAllByRole('row').slice(1)
    // A1 is still « Verrouillée » and healthy, exactly as the server sent it.
    expect(within(rows[0] as HTMLElement).getAllByRole('cell').map((cell) => plain(cell.textContent)).slice(0, 5)).toEqual([
      'ActivéeOui', 'LiaisonConnectée', 'Lecteur RFIDEn bon état', 'PorteFermée', 'SerrureVerrouillée',
    ])
    expect(within(screen.getByRole('main')).getAllByRole('button').map((button) => button.textContent)).toEqual(['Modifier l’horaire'])
    expect(Object.keys(gateway)).toEqual(['getStatus'])
  })

  it('OFFLINE: the connection stays « Hors ligne » beside the errors, which are said to be possibly out of date', async () => {
    renderLocker({ ...OFFLINE, deviceErrors: TWO })
    const section = await errorsSection(/^2 erreurs signalées/)
    expect(plain(screen.getByRole('region', { name: /Casier de démonstration/ }).textContent)).toContain('Hors ligne')
    expect(plain(section.textContent)).toContain("Le casier n'est pas en ligne : cette liste peut ne plus refléter son état.")
    expect(within(section).getAllByRole('listitem')).toHaveLength(2)
  })

  it('empty: says no error was reported since the last start, or that no signal was ever received', async () => {
    renderLocker(lockerStatus())
    let section = await errorsSection(/^0 erreur signalée/)
    expect(plain(section.textContent)).toContain('Aucune erreur signalée depuis le dernier démarrage du casier.')
    expect(within(section).queryByRole('list')).toBeNull()
    expect(plain(section.textContent)).not.toContain("n'est pas en ligne")
    cleanup()

    renderLocker(NEVER_SEEN)
    section = await errorsSection(/^0 erreur signalée/)
    expect(plain(section.textContent)).toContain("Aucun signal reçu du casier : aucune erreur signalée à afficher.")
  })

  it('names an unknown code as sent, an unknown severity as unrecognized, and an unlisted compartment as such', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderLocker(lockerStatus({ deviceErrors: [error({ errorCode: 'FUTURE_FAULT', severity: 'UNRECOGNIZED' as DeviceError['severity'], compartmentId: '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a9999', occurrences: 2 })] }))
    const section = await errorsSection(/^1 erreur signalée/)
    const text = plain(section.textContent)
    expect(text).toContain('Code non reconnu par cette version de Manager')
    expect(text).toContain('FUTURE_FAULT · Cellule non listée · 2 signalements')
  })

  it('at the server limit of 20 groups, says others may exist', async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => error({ errorCode: `CODE_${index}`, compartmentId: null }))
    renderLocker(lockerStatus({ deviceErrors: twenty }))
    const section = await errorsSection(/^20 erreurs signalées/)
    expect(within(section).getAllByRole('listitem')).toHaveLength(20)
    expect(plain(section.textContent)).toContain("Seules les 20 erreurs les plus importantes sont affichées ; d'autres peuvent exister.")
    cleanup()
    renderLocker(lockerStatus({ deviceErrors: twenty.slice(0, 19) }))
    expect(plain((await errorsSection(/^19 erreurs signalées/)).textContent)).not.toContain('Seules les')
  })

  it('in English', async () => {
    renderLocker({ ...OFFLINE, deviceErrors: TWO }, 'en')
    const section = await errorsSection(/^2 reported errors/)
    const text = plain(section.textContent)
    expect(text).toContain('A reported error is not necessarily an active fault')
    expect(text).toContain('The locker is not online: this list may no longer reflect its state.')
    expect(text).toMatch(/CriticalRFID reader faultRFID_READER_FAULT · Compartment A2 · 3 reports/)
    expect(text).toMatch(/Last received: Nov 3, 2026/)
    expect(text).toMatch(/WarningInvalid message receivedINBOUND_MESSAGE_INVALID · Whole locker · 1 report/)
    expect(text).not.toMatch(/signalée|Cellule|Casier entier/)
  })
})
