import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import type { CatalogGateway } from '../features/catalog/catalogGateway'
import type { ProblemResponse } from '../features/auth/contract'
import { asset, fakeCatalogGateway, FLUKE_117, MM001, model, modelPageOf, ok, pageOf } from '../features/catalog/testFixtures'
import type { Locale } from '../i18n/locale'
import { installDialogPolyfill } from '../test/dialog'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const plain = (value: string | null | undefined) => (value ?? '').replace(/[\u00A0\u202F]/g, ' ')
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

function renderEquipment(catalogGateway: CatalogGateway, { locale = 'fr', url = '/equipements' }: { locale?: Locale; url?: string } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, catalogGateway, session, queryClient, locale })
}

const openDialog = () => screen.getByRole('dialog')
const ARCHIVED_MODEL = model({ id: '8f1f3c52-5f2a-4c43-9b6b-0d2f6c1f3a09', name: 'Ancien modèle', archivedAt: '2026-10-01T12:00:00Z' })

describe('Équipements — new unit', () => {
  it('creates a unit from an active model, with the model default and an instant in the laboratory zone, then shows it', async () => {
    const user = userEvent.setup()
    const created = asset({ id: '9b1e0c3a-7d4f-4a2b-9c5d-1e2f3a4b5c6d', assetCode: 'MM-010' })
    const gateway = fakeCatalogGateway({
      pages: [ok(pageOf([MM001]))],
      units: { [MM001.id]: ok(MM001), [created.id]: ok(created) },
      modelPages: [ok(modelPageOf([FLUKE_117, ARCHIVED_MODEL]))],
      overrides: { createAsset: async () => ok(created) },
    })
    renderEquipment(gateway)
    await user.click(await screen.findByRole('button', { name: 'Nouvel exemplaire' }))
    const dialog = openDialog()
    expect(within(dialog).getByRole('heading', { name: 'Nouvel exemplaire' })).toBeDefined()

    const select = within(dialog).getByRole('combobox', { name: /Modèle/ })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    // An archived model is not offered for a new unit.
    expect(within(select).queryByRole('option', { name: /Ancien modèle/ })).toBeNull()
    await user.selectOptions(select, FLUKE_117.id)
    // The model's default proposes calibration.
    expect((within(dialog).getByRole('checkbox', { name: 'Calibration requise' }) as HTMLInputElement).checked).toBe(true)
    await user.type(within(dialog).getByRole('textbox', { name: /Code de l’exemplaire/ }), '  MM-010 ')
    fireEvent.change(within(dialog).getByLabelText(/Échéance de calibration/), { target: { value: '2027-01-15T09:30' } })
    await user.click(within(dialog).getByRole('button', { name: 'Créer' }))

    await waitFor(() => expect(gateway.createAsset).toHaveBeenCalledTimes(1))
    const [token, request, key] = gateway.createAsset.mock.calls[0] ?? []
    expect(token).toBe('token-value')
    expect(request).toEqual({
      assetModelId: FLUKE_117.id,
      assetCode: 'MM-010',
      serialNumber: null,
      requiredAccessLevel: 'STANDARD',
      operationalStatus: 'SERVICEABLE',
      calibrationRequired: true,
      // 09:30 in America/Toronto in January is 14:30 UTC.
      calibrationDueAt: '2027-01-15T14:30:00Z',
    })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.search).toBe(`?exemplaire=${created.id}`)
    expect(plain(screen.getByText('Exemplaire MM-010 créé.').textContent)).toBe('Exemplaire MM-010 créé.')
  })

  it('checks required fields locally and sends nothing', async () => {
    const user = userEvent.setup()
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM001.id]: ok(MM001) }, modelPages: [ok(modelPageOf([FLUKE_117]))] })
    renderEquipment(gateway)
    await user.click(await screen.findByRole('button', { name: 'Nouvel exemplaire' }))
    await user.click(within(openDialog()).getByRole('button', { name: 'Créer' }))
    const select = within(openDialog()).getByRole('combobox', { name: /Modèle/ })
    expect(select.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(select))
    expect(within(openDialog()).getByText('Choisissez un modèle.')).toBeDefined()
    expect(gateway.createAsset).not.toHaveBeenCalled()
  })

  it('puts a uniqueness conflict on its field and keeps the draft', async () => {
    const user = userEvent.setup()
    const gateway = fakeCatalogGateway({
      pages: [ok(pageOf([MM001]))],
      units: { [MM001.id]: ok(MM001) },
      modelPages: [ok(modelPageOf([model({ id: FLUKE_117.id, name: 'Multimètre 1' })]))],
      overrides: { createAsset: async () => problem(409, 'ASSET_CODE_ALREADY_EXISTS') },
    })
    renderEquipment(gateway)
    await user.click(await screen.findByRole('button', { name: 'Nouvel exemplaire' }))
    const dialog = openDialog()
    const select = within(dialog).getByRole('combobox', { name: /Modèle/ })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    await user.selectOptions(select, FLUKE_117.id)
    const code = within(dialog).getByRole('textbox', { name: /Code de l’exemplaire/ })
    await user.type(code, 'MM-001')
    await user.click(within(dialog).getByRole('button', { name: 'Créer' }))
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'))
    expect(within(dialog).getByText('Ce code est déjà utilisé, exemplaires archivés compris.')).toBeDefined()
    expect((code as HTMLInputElement).value).toBe('MM-001')
  })

  it('retries an unanswered creation with the same Idempotency-Key', async () => {
    const user = userEvent.setup()
    const created = asset({ id: '9b1e0c3a-7d4f-4a2b-9c5d-1e2f3a4b5c6d', assetCode: 'MM-011', calibration: { required: false, dueAt: null, status: 'NOT_REQUIRED' } })
    let calls = 0
    const gateway = fakeCatalogGateway({
      pages: [ok(pageOf([MM001]))],
      units: { [MM001.id]: ok(MM001), [created.id]: ok(created) },
      modelPages: [ok(modelPageOf([model({ id: FLUKE_117.id, name: 'Multimètre 1' })]))],
      overrides: { createAsset: async () => (++calls === 1 ? offline : ok(created)) },
    })
    renderEquipment(gateway)
    await user.click(await screen.findByRole('button', { name: 'Nouvel exemplaire' }))
    const dialog = openDialog()
    const select = within(dialog).getByRole('combobox', { name: /Modèle/ })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    await user.selectOptions(select, FLUKE_117.id)
    await user.type(within(dialog).getByRole('textbox', { name: /Code de l’exemplaire/ }), 'MM-011')
    await user.click(within(dialog).getByRole('button', { name: 'Créer' }))
    expect(await within(dialog).findByText('Aucune réponse du service.')).toBeDefined()
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(gateway.createAsset).toHaveBeenCalledTimes(2))
    expect(gateway.createAsset.mock.calls[1]?.[2]).toBe(gateway.createAsset.mock.calls[0]?.[2])
  })
})

describe('Équipements — edit and archive a unit', () => {
  it('replaces the settings with PUT, keeping the untouched calibration instant exactly', async () => {
    const user = userEvent.setup()
    const due = '2026-12-01T05:00:17Z'
    const unit = asset({ id: MM001.id, assetCode: 'MM-001', calibration: { required: true, dueAt: due, status: 'VALID' } })
    const gateway = fakeCatalogGateway({
      pages: [ok(pageOf([unit]))],
      units: { [unit.id]: ok(unit) },
      modelPages: [ok(modelPageOf([FLUKE_117]))],
      overrides: { updateAsset: async (_t, _id, request) => ok({ ...unit, operationalStatus: request.operationalStatus }) },
    })
    renderEquipment(gateway)
    await screen.findByRole('heading', { level: 2, name: /MM-001/ })
    await user.click(screen.getByRole('button', { name: 'Modifier' }))
    const dialog = openDialog()
    expect(within(dialog).getByRole('heading', { name: 'Modifier l’exemplaire MM-001' })).toBeDefined()
    await user.click(within(dialog).getByRole('radio', { name: 'En maintenance' }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(gateway.updateAsset).toHaveBeenCalledTimes(1))
    const [, assetId, request] = gateway.updateAsset.mock.calls[0] ?? []
    expect(assetId).toBe(unit.id)
    expect(request).toMatchObject({ assetCode: 'MM-001', serialNumber: null, operationalStatus: 'MAINTENANCE', calibrationDueAt: due })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Modifications de l’exemplaire MM-001 enregistrées.')).toBeDefined()
  })

  it('confirms an archive, focuses Cancel first, and explains a business refusal by its code', async () => {
    const user = userEvent.setup()
    const gateway = fakeCatalogGateway({
      pages: [ok(pageOf([MM001]))],
      units: { [MM001.id]: ok(MM001) },
      overrides: { archiveAsset: async () => problem(409, 'ASSET_HAS_OPEN_LOAN', { detail: 'server words never shown' }) },
    })
    renderEquipment(gateway)
    await screen.findByRole('heading', { level: 2, name: /MM-001/ })
    await user.click(screen.getByRole('button', { name: 'Archiver' }))
    const dialog = screen.getByRole('alertdialog')
    expect(plain(within(dialog).getByRole('heading').textContent)).toBe('Archiver l’exemplaire MM-001 ?')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Annuler' }))
    await user.click(within(dialog).getByRole('button', { name: 'Archiver' }))
    expect(await within(dialog).findByText('Impossible pendant un emprunt en cours.')).toBeDefined()
    expect(dialog.textContent).not.toContain('server words never shown')
    expect(gateway.archiveAsset.mock.calls[0]?.[1]).toBe(MM001.id)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // The closed dialog stays mounted, so focus goes back to the button that opened it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Archiver' }))
  })

  it('keeps one archive key per opening: a retry reuses it, a new opening never does', async () => {
    const user = userEvent.setup()
    const gateway = fakeCatalogGateway({ pages: [ok(pageOf([MM001]))], units: { [MM001.id]: ok(MM001) } })
    renderEquipment(gateway)
    await screen.findByRole('heading', { level: 2, name: /MM-001/ })
    await user.click(screen.getByRole('button', { name: 'Archiver' }))
    let dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archiver' }))
    expect(await within(dialog).findByText('Aucune réponse du service.')).toBeDefined()
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(gateway.archiveAsset).toHaveBeenCalledTimes(2))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Archiver' }))
    dialog = screen.getByRole('alertdialog')
    expect(within(dialog).queryByText('Aucune réponse du service.')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Archiver' }))
    await waitFor(() => expect(gateway.archiveAsset).toHaveBeenCalledTimes(3))
    const keys = gateway.archiveAsset.mock.calls.map((call) => call[2])
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
    expect(gateway.archiveAsset.mock.calls.every((call) => call[1] === MM001.id)).toBe(true)
  })

  it('offers no command for an archived unit', async () => {
    const archived = asset({ id: MM001.id, assetCode: 'MM-001', archivedAt: '2026-10-02T12:00:00Z' })
    renderEquipment(fakeCatalogGateway({ pages: [ok(pageOf([archived]))], units: { [archived.id]: ok(archived) } }))
    await screen.findByText('Exemplaire archivé : ses réglages ne se modifient plus.')
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archiver' })).toBeNull()
  })
})

describe('Équipements — models', () => {
  it('lists the models with their actions, archived ones without any', async () => {
    renderEquipment(fakeCatalogGateway({ modelPages: [ok(modelPageOf([FLUKE_117, ARCHIVED_MODEL]))] }), { url: '/equipements?vue=modeles' })
    expect(await screen.findByRole('heading', { level: 2, name: '2 modèles' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Modèles' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('group', { name: 'Actions du modèle Multimètre 1' })).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Actions du modèle Ancien modèle' })).toBeNull()
  })

  it('creates a model with trimmed text and null optional fields', async () => {
    const user = userEvent.setup()
    const created = model({ id: '1a2b3c4d-1111-4222-8333-444455556666', name: 'Oscilloscope' })
    const gateway = fakeCatalogGateway({ modelPages: [ok(modelPageOf([]))], overrides: { createModel: async () => ok(created) } })
    renderEquipment(gateway, { url: '/equipements?vue=modeles' })
    await screen.findByText('Aucun modèle.')
    await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }))
    await user.type(within(openDialog()).getByRole('textbox', { name: /Nom/ }), ' Oscilloscope ')
    await user.click(within(openDialog()).getByRole('button', { name: 'Créer' }))
    await waitFor(() => expect(gateway.createModel).toHaveBeenCalledTimes(1))
    expect(gateway.createModel.mock.calls[0]?.[1]).toEqual({
      name: 'Oscilloscope',
      manufacturer: null,
      modelNumber: null,
      description: null,
      defaultCalibrationRequired: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Modèle Oscilloscope créé.')).toBeDefined()
    // The list is read again after the change.
    await waitFor(() => expect(gateway.listModels.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows a model in use as a refusal, in English too', async () => {
    const user = userEvent.setup()
    const gateway = fakeCatalogGateway({
      modelPages: [ok(modelPageOf([FLUKE_117]))],
      overrides: { archiveModel: async () => problem(409, 'ASSET_MODEL_IN_USE') },
    })
    renderEquipment(gateway, { url: '/equipements?vue=modeles', locale: 'en' })
    const group = await screen.findByRole('group', { name: /Multimètre 1/ })
    await user.click(within(group).getByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getAllByRole('button', { name: 'Archive' }).at(-1) as HTMLElement)
    await waitFor(() => expect(gateway.archiveModel).toHaveBeenCalledTimes(1))
    expect(gateway.archiveModel.mock.calls[0]?.[1]).toBe(FLUKE_117.id)
    expect(await within(dialog).findByRole('alert')).toBeDefined()
  })
})
