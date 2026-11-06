import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { ProblemResponse } from '../features/auth/contract'
import { asset, fakeCatalogGateway, MM001, ok, pageOf } from '../features/catalog/testFixtures'
import type { CustodyGateway } from '../features/custody/custodyGateway'
import { A1_ID, A2_ID, demoLocker, fakeCustodyGateway, identifier, LOCKER_ID, okResult } from '../features/custody/testFixtures'
import type { Locale } from '../i18n/locale'
import { installDialogPolyfill } from '../test/dialog'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
const problem = (status: number, code: string, extra: Partial<ProblemResponse> = {}) =>
  ({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId: 'trace-0001', ...extra }), retryAfter: null, requestId: 'req-x' }) as const
const offline = { kind: 'network', reason: 'offline' } as const
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')

configure({ asyncUtilTimeout: 4000 })
beforeAll(installDialogPolyfill)
beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

const PLACED = asset({ ...MM001, placement: { lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1_ID, compartmentCode: 'A1' } })
const TAG = identifier({ assetId: PLACED.id })
const OLD_NFC = identifier({ id: '3c4d5e6f-7081-4a92-8ba3-b4c5d6e7f809', assetId: PLACED.id, type: 'NFC', value: '04:A2:19:7B', active: false, revokedAt: '2026-10-20T15:00:00Z' })

function renderEquipment(custodyGateway: CustodyGateway, { unit = PLACED, locale = 'fr' }: { unit?: typeof PLACED; locale?: Locale } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', '/equipements')
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const catalogGateway = fakeCatalogGateway({ pages: [ok(pageOf([unit]))], units: { [unit.id]: ok(unit) } })
  return { catalogGateway, ...renderWithProviders(<App />, { gateway: authGateway, catalogGateway, custodyGateway, session, queryClient, locale }) }
}

const history = () => screen.findByRole('list', { name: 'Historique des identifiants' })

describe('Équipements — identifiers (CAT-02 #26)', () => {
  it('lists the history, active first, with the server’s states and no revoke on a revoked one', async () => {
    renderEquipment(fakeCustodyGateway({ listIdentifiers: async () => okResult([TAG, OLD_NFC]) }))
    const items = within(await history()).getAllByRole('listitem')
    expect(items.map((item) => plain(item.textContent))).toEqual([expect.stringMatching(/^RFID UHF.*E20034120123456789000001.*Actif.*Attribué le .*Révoquer$/), expect.stringMatching(/^NFC.*04:A2:19:7B.*Révoqué.*Révoqué le /)])
    expect(within(items[1]!).queryByRole('button')).toBeNull()
    expect(within(items[0]!).getByRole('button', { name: 'Révoquer RFID UHF E20034120123456789000001' })).toBeDefined()
  })

  it('assigns with one Idempotency-Key per intent, reuses it on retry, then reads the history again', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const gateway = fakeCustodyGateway({
      listIdentifiers: async () => okResult(attempts >= 2 ? [identifier({ assetId: PLACED.id, type: 'QR', value: 'AEGIS:MM-001' }), TAG] : [TAG]),
      assignIdentifier: async () => (++attempts === 1 ? offline : okResult(identifier({ assetId: PLACED.id, type: 'QR', value: 'AEGIS:MM-001' }))),
    })
    renderEquipment(gateway)
    await history()
    await user.click(screen.getByRole('button', { name: 'Attribuer un identifiant' }))
    const dialog = screen.getByRole('dialog', { name: 'Attribuer un identifiant à MM-001' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Type' }), 'QR')
    await user.type(within(dialog).getByRole('textbox', { name: /Valeur/ }), '  AEGIS:MM-001 ')
    await user.click(within(dialog).getByRole('button', { name: 'Attribuer un identifiant' }))
    expect(await within(dialog).findByText('Aucune réponse du service.')).toBeDefined()
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const calls = gateway.assignIdentifier.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![2]).toEqual({ type: 'QR', value: 'AEGIS:MM-001' })
    expect(calls[0]![3]).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls[1]![3]).toBe(calls[0]![3])
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Historique des identifiants' })).getAllByRole('listitem')).toHaveLength(2))
    expect(await screen.findByText('Identifiant attribué à MM-001.')).toBeDefined()
  })

  it('puts IDENTIFIER_ALREADY_ASSIGNED on the value, and a custody refusal in the alert', async () => {
    const user = userEvent.setup()
    const answers = [problem(409, 'IDENTIFIER_ALREADY_ASSIGNED'), problem(409, 'ASSET_OPERATION_IN_PROGRESS')]
    renderEquipment(fakeCustodyGateway({ assignIdentifier: async () => answers.shift()! }))
    await history().catch(() => undefined)
    await user.click(await screen.findByRole('button', { name: 'Attribuer un identifiant' }))
    const dialog = screen.getByRole('dialog')
    const value = within(dialog).getByRole('textbox', { name: /Valeur/ })
    await user.type(value, 'E2003412')
    await user.click(within(dialog).getByRole('button', { name: 'Attribuer un identifiant' }))
    await waitFor(() => expect(value.getAttribute('aria-invalid')).toBe('true'))
    expect(description(value)).toContain('Cette valeur est déjà attribuée à un identifiant actif.')

    await user.type(value, '9')
    await user.click(within(dialog).getByRole('button', { name: 'Attribuer un identifiant' }))
    expect(plain((await within(dialog).findByRole('alert')).textContent)).toContain('Impossible pendant une opération du casier en cours.')
  })

  it('requires a value before sending', async () => {
    const user = userEvent.setup()
    const gateway = fakeCustodyGateway()
    renderEquipment(gateway)
    await user.click(await screen.findByRole('button', { name: 'Attribuer un identifiant' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Attribuer un identifiant' }))
    expect(within(dialog).getByRole('textbox', { name: /Valeur/ }).getAttribute('aria-invalid')).toBe('true')
    expect(gateway.assignIdentifier).not.toHaveBeenCalled()
  })

  it('revokes after a confirmation that starts on Cancel, with an idempotency key', async () => {
    const user = userEvent.setup()
    const gateway = fakeCustodyGateway({
      listIdentifiers: async () => okResult([TAG]),
      revokeIdentifier: async () => okResult({ ...TAG, active: false, revokedAt: '2026-11-06T15:00:00Z' }),
    })
    renderEquipment(gateway)
    await history()
    await user.click(screen.getByRole('button', { name: 'Révoquer RFID UHF E20034120123456789000001' }))
    const dialog = screen.getByRole('alertdialog')
    expect(plain(within(dialog).getByRole('heading').textContent)).toBe('Révoquer l’identifiant RFID UHF E20034120123456789000001 ?')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Annuler' }))
    await user.click(within(dialog).getByRole('button', { name: 'Révoquer' }))
    await waitFor(() => expect(gateway.revokeIdentifier).toHaveBeenCalledTimes(1))
    const [, assetId, identifierId, key] = gateway.revokeIdentifier.mock.calls[0]!
    expect([assetId, identifierId]).toEqual([PLACED.id, TAG.id])
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText('Identifiant de MM-001 révoqué.')).toBeDefined()
  })

  it('offers no change on an archived unit', async () => {
    renderEquipment(fakeCustodyGateway({ listIdentifiers: async () => okResult([OLD_NFC]) }), { unit: { ...PLACED, archivedAt: '2026-11-02T12:00:00Z', placement: null } })
    await history()
    expect(screen.queryByRole('button', { name: 'Attribuer un identifiant' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Modifier le placement' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Révoquer/ })).toBeNull()
  })
})

describe('Équipements — placement (CAT-02 #26)', () => {
  it('reads the lockers at opening, labels occupancy as read, and saves with a PUT of the compartment and reason', async () => {
    const user = userEvent.setup()
    const gateway = fakeCustodyGateway({
      listLockers: async () => okResult({ items: [demoLocker({ id: PLACED.id, assetCode: 'MM-001' })], page: 0, size: 100, totalItems: 1, totalPages: 1 }),
      setPlacement: async () =>
        okResult({ id: 'p2', assetId: PLACED.id, lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A2_ID, compartmentCode: 'A2', assignedAt: '2026-11-06T15:00:00Z', reason: 'Rotation' }),
    })
    const { catalogGateway } = renderEquipment(gateway)
    await user.click(await screen.findByRole('button', { name: 'Modifier le placement' }))
    const dialog = screen.getByRole('dialog', { name: 'Placement de MM-001' })
    const compartment = await within(dialog).findByRole('combobox', { name: /Cellule/ })
    expect(gateway.listLockers).toHaveBeenCalledWith('token-value', { page: 0, size: 100 }, expect.anything())
    expect((within(dialog).getByRole('combobox', { name: /Casier/ }) as HTMLSelectElement).value).toBe(LOCKER_ID)
    expect((compartment as HTMLSelectElement).value).toBe(A1_ID)
    expect(within(compartment).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choisir une cellule',
      'A1 — placement actuel',
      'A2 — occupée par MM-099',
      'A3 — désactivée',
    ])
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: /Casier/ })))

    await user.selectOptions(compartment, A2_ID)
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(within(dialog).getByRole('textbox', { name: /Motif/ }).getAttribute('aria-invalid')).toBe('true')
    expect(gateway.setPlacement).not.toHaveBeenCalled()

    await user.type(within(dialog).getByRole('textbox', { name: /Motif/ }), ' Rotation ')
    const reads = catalogGateway.getAsset.mock.calls.length + catalogGateway.listAssets.mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(gateway.setPlacement).toHaveBeenCalledWith('token-value', PLACED.id, { compartmentId: A2_ID, reason: 'Rotation' })
    expect(gateway.setPlacement.mock.calls[0]).toHaveLength(3)
    await waitFor(() => expect(catalogGateway.getAsset.mock.calls.length + catalogGateway.listAssets.mock.calls.length).toBeGreaterThan(reads))
    expect(await screen.findByText('MM-001 placé dans AEGIS-DEMO-01 · A2.')).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Modifier le placement' }))
  })

  it('puts COMPARTMENT_ALREADY_OCCUPIED and COMPARTMENT_NOT_FOUND on the compartment, and a reservation refusal in the alert', async () => {
    const user = userEvent.setup()
    const answers = [
      problem(409, 'COMPARTMENT_ALREADY_OCCUPIED'),
      problem(400, 'VALIDATION_ERROR', { violations: [{ field: 'compartmentId', code: 'COMPARTMENT_NOT_FOUND', message: 'x' }] }),
      problem(409, 'ASSET_ALREADY_RESERVED'),
    ]
    renderEquipment(fakeCustodyGateway({ setPlacement: async () => answers.shift()! }))
    await user.click(await screen.findByRole('button', { name: 'Modifier le placement' }))
    const dialog = screen.getByRole('dialog')
    const compartment = await within(dialog).findByRole('combobox', { name: /Cellule/ })
    await user.selectOptions(compartment, A2_ID)
    await user.type(within(dialog).getByRole('textbox', { name: /Motif/ }), 'Essai')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(description(compartment)).toContain('Un autre exemplaire occupe déjà cette cellule.'))

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(description(compartment)).toContain('Cette cellule n’existe plus.'))

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(plain((await within(dialog).findByRole('alert')).textContent)).toContain('Impossible pendant une réservation active.')
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('reports a locker list that cannot be read, and reads again on request', async () => {
    const user = userEvent.setup()
    const answers = [offline, okResult({ items: [demoLocker()], page: 0, size: 100, totalItems: 1, totalPages: 1 })]
    renderEquipment(fakeCustodyGateway({ listLockers: async () => answers.shift()! }))
    await user.click(await screen.findByRole('button', { name: 'Modifier le placement' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('Les casiers n’ont pas pu être lus. Fermez, puis réessayez.')).toBeDefined()
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    expect(await within(dialog).findByRole('combobox', { name: /Cellule/ })).toBeDefined()
  })

  it('speaks English', async () => {
    const user = userEvent.setup()
    renderEquipment(fakeCustodyGateway({ listIdentifiers: async () => okResult([TAG]) }), { locale: 'en' })
    expect(await screen.findByRole('list', { name: 'Identifier history' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Change placement' }))
    const compartment = await within(screen.getByRole('dialog', { name: 'Placement of MM-001' })).findByRole('combobox', { name: /Compartment/ })
    expect(within(compartment).getAllByRole('option').map((option) => option.textContent)).toContain('A2 — occupied by MM-099')
  })
})
