import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import type { AnomalyGateway } from '../features/anomalies/anomalyGateway'
import { ANOMALY_ID, anomalyPageOf, fakeAnomalyGateway, ok, parsedAnomaly } from '../features/anomalies/testFixtures'
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

const OPEN = parsedAnomaly()
const ACKNOWLEDGED = parsedAnomaly({
  status: 'ACKNOWLEDGED',
  acknowledgedAt: '2026-11-10T19:10:00Z',
  acknowledgedBy: { id: '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8', displayName: 'Administrateur de démonstration' },
  acknowledgementNote: 'Inspection planifiée.',
})
const RESOLVED = parsedAnomaly({ status: 'RESOLVED', resolvedAt: '2026-11-10T19:20:00Z', resolutionEvidenceObservationId: '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e' })
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const detail = (view: ReturnType<typeof parsedAnomaly>) => ok({ ...view, evidence: { items: [], unreadable: 0 } })

/** A server whose anomaly is `current`; `serverNow` changes what the next reads return, as a real server would. */
function scriptedServer(initial: ReturnType<typeof parsedAnomaly>, overrides: Partial<AnomalyGateway> = {}) {
  const state = { current: initial }
  const gateway = fakeAnomalyGateway({
    listAnomalies: async (_token, query) => ok(anomalyPageOf(query.status === undefined || query.status === state.current.status ? [state.current] : [])),
    getAnomaly: async () => detail(state.current),
    ...overrides,
  })
  return { gateway, state }
}

function renderAnomalies(anomalyGateway: AnomalyGateway, { locale = 'fr' as Locale, url = '/anomalies' } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-11-11T20:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, anomalyGateway, session, queryClient, locale })
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const opener = await screen.findByRole('button', { name: 'Reconnaître' })
  await user.click(opener)
  return { opener, dialog: screen.getByRole('dialog'), note: screen.getByRole('textbox', { name: /Note de reconnaissance/ }) as HTMLTextAreaElement }
}

describe('Anomalies — acknowledgement dialog', () => {
  it('opens on the note, says it does not resolve, and traps and restores focus', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN)
    renderAnomalies(gateway)
    const { opener, dialog, note } = await openDialog(user)
    expect(document.activeElement).toBe(note)
    expect(within(dialog).getByRole('heading', { name: 'Reconnaître cette anomalie' })).toBeDefined()
    expect(within(dialog).getByText(/L’anomalie n’est pas résolue/)).toBeDefined()
    expect(within(dialog).getByText('Obligatoire, de 1 à 500 caractères. Elle est conservée avec votre nom et l’heure.')).toBeDefined()
    expect(note.getAttribute('aria-describedby')).toContain('-counter')
    expect(within(dialog).getByText('0 / 500')).toBeDefined()
    // Tab wraps from the last control to the first, Shift+Tab the other way.
    const submit = within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' })
    const close = within(dialog).getByRole('button', { name: 'Fermer' })
    submit.focus()
    await user.tab()
    expect(document.activeElement).toBe(close)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(submit)
    // Escape closes without sending anything; focus returns to the button that opened it.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
    expect(gateway.acknowledge).not.toHaveBeenCalled()
  })

  it('starts empty on each opening: the note is lost on an explicit close', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN)
    renderAnomalies(gateway)
    const first = await openDialog(user)
    await user.type(first.note, 'Brouillon')
    await user.click(within(first.dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const second = await openDialog(user)
    expect(second.note.value).toBe('')
  })

  it.each([['an empty note', ''], ['a note of spaces and a line break', '   \n  ']])('refuses %s locally, names the field and sends nothing', async (_label, text) => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN)
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    if (text !== '') await user.type(note, text)
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    const error = await within(dialog).findByText('Saisissez une note de reconnaissance.')
    expect(note.getAttribute('aria-invalid')).toBe('true')
    expect(note.getAttribute('aria-describedby')).toContain(error.closest('p')?.id)
    expect(document.activeElement).toBe(note)
    expect(gateway.acknowledge).not.toHaveBeenCalled()
  })

  it('counts graphemes for information only and lets the server judge a long note', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN, { acknowledge: async () => problem(400, 'VALIDATION_ERROR', { violations: [{ field: 'note', code: 'SIZE', message: 'x' }] }) })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    const long = 'é'.repeat(501)
    await user.click(note)
    await user.paste(long)
    expect(within(dialog).getByText('501 / 500, au-delà de la limite indiquée')).toBeDefined()
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    // The client did not stop it; the server's field violation is shown under the field, the note is kept.
    await waitFor(() => expect(gateway.acknowledge).toHaveBeenCalledTimes(1))
    expect(gateway.acknowledge.mock.calls[0]?.[2]).toEqual({ note: long })
    expect(await within(dialog).findByText('La note compte au plus 500 caractères.')).toBeDefined()
    expect(note.value).toBe(long)
    expect(note.getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('shows the server’s generic refusal of a note it does not accept (400 on another violation)', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN, { acknowledge: async () => problem(400, 'VALIDATION_ERROR', { violations: [{ field: 'note', code: 'INVALID_VALUE', message: 'x' }] }) })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'a')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    expect(await within(dialog).findByText(/La note n’a pas été acceptée/)).toBeDefined()
  })
})

describe('Anomalies — acknowledgement outcomes', () => {
  it('acknowledges: the server’s answer is shown, the anomaly stays visible as « Reconnue », it is not resolved', async () => {
    const user = userEvent.setup()
    const { gateway, state } = scriptedServer(OPEN, {
      acknowledge: async () => {
        state.current = ACKNOWLEDGED
        return ok(ACKNOWLEDGED)
      },
    })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'Inspection planifiée.')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(gateway.acknowledge).toHaveBeenCalledTimes(1)
    const [token, id, request, key] = gateway.acknowledge.mock.calls[0] ?? []
    expect([token, id, request]).toEqual(['token-value', ANOMALY_ID, { note: 'Inspection planifiée.' }])
    expect(key).toMatch(KEY)

    const dossier = screen.getByRole('group', { name: 'Équipement attendu non observé' })
    expect(await within(dossier).findByText('Anomalie reconnue. Elle n’est pas résolue.')).toBeDefined()
    expect(within(dossier).getAllByText('Reconnue').length).toBeGreaterThan(0)
    expect(within(dossier).getByText(/Reconnue par Administrateur de démonstration à/)).toBeDefined()
    expect(within(dossier).getByText('Inspection planifiée.')).toBeDefined()
    expect(within(dossier).queryByRole('button', { name: 'Reconnaître' })).toBeNull()
    expect(within(dossier).getByText(/Non résolue/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /résoudre/i })).toBeNull()
    // Focus lands on the dossier (the button is gone); the address names the anomaly, so it outlives the « Ouvertes » filter.
    await waitFor(() => expect(document.activeElement).toBe(dossier))
    expect(window.location.search).toBe(`?statut=ouvertes&anomalie=${ANOMALY_ID}`)
    // Read again from the server: the open list no longer holds it, the dossier does.
    await waitFor(() => expect(gateway.getAnomaly.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.getByText('Aucune anomalie ne correspond à ces filtres.')).toBeDefined())
    expect(screen.getByRole('group', { name: 'Équipement attendu non observé' })).toBeDefined()
  })

  it('disables a second submit while the request runs, and ignores Escape and the close button', async () => {
    const user = userEvent.setup()
    let release: (value: ReturnType<typeof ok<typeof ACKNOWLEDGED>>) => void = () => undefined
    const { gateway } = scriptedServer(OPEN, { acknowledge: () => new Promise((resolve) => (release = resolve)) })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'Une note')
    const submit = within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' })
    await user.click(submit)
    await user.click(submit)
    expect(gateway.acknowledge).toHaveBeenCalledTimes(1)
    expect(note.readOnly).toBe(true)
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: 'Fermer' }))
    expect(screen.getByRole('dialog')).toBeDefined()
    release(ok(ACKNOWLEDGED))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('on a 409 already resolved: keeps the dialog and the read-only note, re-reads, then says what the server holds', async () => {
    const user = userEvent.setup()
    const { gateway, state } = scriptedServer(OPEN, {
      acknowledge: async () => {
        state.current = RESOLVED
        return problem(409, 'ANOMALY_ALREADY_RESOLVED')
      },
    })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'Ma note')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))

    expect(await within(dialog).findByText('Cette anomalie est déjà résolue.')).toBeDefined()
    expect(within(dialog).getByText(/Aucune reconnaissance n’a été enregistrée/)).toBeDefined()
    expect(within(dialog).getByText(/État actuel selon le serveur\s*: Résolue\./)).toBeDefined()
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(note.value).toBe('Ma note')
    expect(note.readOnly).toBe(true)
    // The dossier was read again (never patched by the client), and the submit is gone: a refused intent is not retried.
    expect(gateway.getAnomaly.mock.calls.length).toBeGreaterThan(1)
    expect(within(dialog).queryByRole('button', { name: 'Reconnaître l’anomalie' })).toBeNull()
    expect(document.activeElement).toBe(within(dialog).getByRole('alert').parentElement)

    await user.click(within(dialog.querySelector('.ag-dialog__actions') as HTMLElement).getByRole('button', { name: 'Fermer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const dossier = screen.getByRole('group', { name: 'Équipement attendu non observé' })
    await within(dossier).findByText('Cette anomalie a été résolue entre-temps.')
    expect(within(dossier).getAllByText('Résolue').length).toBeGreaterThan(0)
    expect(within(dossier).queryByRole('button', { name: 'Reconnaître' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(dossier))
  })

  it('on a 409 not acknowledgeable: says so, shows the server state, and the note stays until it is closed', async () => {
    const user = userEvent.setup()
    const { gateway, state } = scriptedServer(OPEN, {
      acknowledge: async () => {
        state.current = ACKNOWLEDGED
        return problem(409, 'ANOMALY_NOT_ACKNOWLEDGEABLE')
      },
    })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'Ma note')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    expect(await within(dialog).findByText('Cette anomalie ne peut pas être reconnue dans son état actuel.')).toBeDefined()
    expect(within(dialog).getByText(/État actuel selon le serveur\s*: Reconnue\./)).toBeDefined()
    expect(note.value).toBe('Ma note')
    expect(note.readOnly).toBe(true)
    await user.click(within(dialog.querySelector('.ag-dialog__actions') as HTMLElement).getByRole('button', { name: 'Fermer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The dossier now shows the other administrator’s acknowledgement, not this note.
    expect(await screen.findByText('Inspection planifiée.')).toBeDefined()
    expect(screen.queryByText('Cette anomalie a été résolue entre-temps.')).toBeNull()
  })

  it('on a 409 whose re-read fails: says the state is unknown and offers to read it again', async () => {
    const user = userEvent.setup()
    let reads = 0
    const { gateway } = scriptedServer(OPEN, {
      acknowledge: async () => problem(409, 'ANOMALY_NOT_ACKNOWLEDGEABLE'),
      getAnomaly: async () => (++reads === 1 ? detail(OPEN) : offline),
    })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'Ma note')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    expect(await within(dialog).findByText('L’état actuel n’a pas pu être relu.')).toBeDefined()
    gateway.getAnomaly.mockImplementation(async () => detail(ACKNOWLEDGED))
    await user.click(within(dialog).getByRole('button', { name: 'Relire le dossier' }))
    expect(await within(dialog).findByText(/État actuel selon le serveur\s*: Reconnue\./)).toBeDefined()
    expect(note.value).toBe('Ma note')
  })

  it('retries after a lost answer with the same Idempotency-Key, and a changed note is a new intent', async () => {
    const user = userEvent.setup()
    const { gateway, state } = scriptedServer(OPEN)
    gateway.acknowledge.mockImplementationOnce(async () => offline)
    gateway.acknowledge.mockImplementationOnce(async () => offline)
    gateway.acknowledge.mockImplementationOnce(async () => offline)
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'Inspection planifiée.')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('La reconnaissance n’a pas été confirmée.')).toBeDefined()
    expect(within(alert).getByText(/Réessayer est sans risque/)).toBeDefined()
    expect(document.activeElement).toBe(alert.parentElement)
    expect(screen.getByRole('dialog')).toBeDefined()

    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(gateway.acknowledge).toHaveBeenCalledTimes(2))
    const keys = gateway.acknowledge.mock.calls.map((call) => call[3])
    expect(keys[0]).toMatch(KEY)
    expect(keys[1]).toBe(keys[0])
    expect(gateway.acknowledge.mock.calls.map((call) => call[2])).toEqual([{ note: 'Inspection planifiée.' }, { note: 'Inspection planifiée.' }])

    // Editing the note while the outcome is unknown is another intent: another key, never IDEMPOTENCY_KEY_REUSED.
    await within(dialog).findByRole('alert')
    await user.type(note, ' Complément.')
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(gateway.acknowledge).toHaveBeenCalledTimes(3))
    expect(gateway.acknowledge.mock.calls[2]?.[3]).not.toBe(keys[0])

    gateway.acknowledge.mockImplementation(async () => {
      state.current = ACKNOWLEDGED
      return ok(ACKNOWLEDGED)
    })
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(gateway.acknowledge.mock.calls[3]?.[3]).toBe(gateway.acknowledge.mock.calls[2]?.[3])
  })

  it('shows a service error with its trace ID and a safe retry', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN, { acknowledge: async () => problem(500, 'INTERNAL_ERROR') })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('Le service n’a pas pu enregistrer la reconnaissance.')).toBeDefined()
    expect(within(alert).getByText('trace-0001')).toBeDefined()
    expect(within(dialog).getByRole('button', { name: 'Réessayer' })).toBeDefined()
  })

  it('shows a 403 as final: no retry, no recorded acknowledgement', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN, { acknowledge: async () => problem(403, 'FORBIDDEN') })
    renderAnomalies(gateway)
    const { dialog, note } = await openDialog(user)
    await user.type(note, 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Reconnaître l’anomalie' }))
    expect(await within(dialog).findByText('Votre compte n’a pas le droit de reconnaître cette anomalie.')).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: /Réessayer|Reconnaître l’anomalie/ })).toBeNull()
    expect(within(dialog).getAllByRole('button', { name: 'Fermer' })).toHaveLength(2)
  })

  it('speaks English throughout the dialog', async () => {
    const user = userEvent.setup()
    const { gateway } = scriptedServer(OPEN, { acknowledge: async () => problem(409, 'ANOMALY_ALREADY_RESOLVED') })
    renderAnomalies(gateway, { locale: 'en' })
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Acknowledge this anomaly' })).toBeDefined()
    await user.type(within(dialog).getByRole('textbox', { name: /Acknowledgement note/ }), 'Note')
    await user.click(within(dialog).getByRole('button', { name: 'Acknowledge the anomaly' }))
    expect(await within(dialog).findByText('This anomaly is already resolved.')).toBeDefined()
    expect(within(dialog).getByText('Current state according to the server: Open.')).toBeDefined()
  })
})
