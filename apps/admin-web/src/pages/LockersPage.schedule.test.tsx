import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import { fakeCatalogGateway, MM001, ok as catalogOk, pageOf } from '../features/catalog/testFixtures'
import { A1, DEMO_LOCKER_ID, fakeLockerGateway, lockerStatus, ok } from '../features/lockers/testFixtures'
import type { OperatingScheduleView } from '../features/schedule/contract'
import type { ScheduleGateway } from '../features/schedule/scheduleGateway'
import { scheduleView } from '../features/schedule/testFixtures'
import type { Locale } from '../i18n/locale'
import { installDialogPolyfill } from '../test/dialog'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const PLACED = { ...MM001, placement: { lockerId: DEMO_LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1.id, compartmentCode: 'A1' } }
const okSchedule = (value: OperatingScheduleView) => ({ kind: 'ok', value, requestId: 'req-s' }) as const
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'httpProblem', status, problem: { ...problemBody(status, code), ...extra }, retryAfter: null, requestId: 'req-x' }) as const

type Answer = Awaited<ReturnType<ScheduleGateway['getSchedule']>>

function fakeScheduleGateway(get: Answer[], put: Answer[] = []): Mocked<ScheduleGateway> {
  let gets = 0
  let puts = 0
  return {
    getSchedule: vi.fn(async () => get[Math.min(gets++, get.length - 1)]!),
    putSchedule: vi.fn(async () => put[Math.min(puts++, put.length - 1)]!),
  }
}

function renderLockers(scheduleGateway: ScheduleGateway, { locale = 'fr' }: { locale?: Locale } = {}) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', '/casiers')
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const lockerGateway = fakeLockerGateway({ [DEMO_LOCKER_ID]: [ok(lockerStatus())] })
  const catalogGateway = fakeCatalogGateway({ pages: [catalogOk(pageOf([PLACED]))] })
  return { lockerGateway, ...renderWithProviders(<App />, { gateway: authGateway, catalogGateway, lockerGateway, scheduleGateway, session, queryClient, locale }) }
}

async function openEditor(name = 'Modifier l’horaire') {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name }))
  const dialog = await screen.findByRole('dialog')
  return { user, dialog }
}

const value = (element: HTMLElement) => (element as HTMLInputElement).value
const checked = (element: HTMLElement) => (element as HTMLInputElement).checked
/** The text of the elements an input names in `aria-describedby`. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
const day = (dialog: HTMLElement, name: string) => within(dialog).getByRole('group', { name })

configure({ asyncUtilTimeout: 4000 })
beforeAll(installDialogPolyfill)
beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('Casiers — operating schedule editor (CFG-02 #28)', () => {
  it('reads the active version, shows the zone and seven days, and saves a change with one PUT and no idempotency key', async () => {
    const saved = scheduleView({ id: 'next-version', windows: scheduleView().windows.map((w) => (w.dayOfWeek === 'SATURDAY' ? { ...w, enabled: true, opensAt: '09:00:00', closesAt: '12:30:00' } : w)) })
    const gateway = fakeScheduleGateway([okSchedule(scheduleView())], [okSchedule(saved)])
    const { lockerGateway } = renderLockers(gateway)
    const { user, dialog } = await openEditor()

    const zone = await within(dialog).findByRole('textbox', { name: /Fuseau horaire/ })
    expect(value(zone)).toBe('America/Toronto')
    // The form arrives after the read: the zone field then takes the focus the dialog held.
    await waitFor(() => expect(document.activeElement).toBe(zone))
    expect(within(dialog).getAllByRole('group').map((group) => group.querySelector('legend')?.textContent)).toEqual(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'])
    expect(value(within(day(dialog, 'Lundi')).getByLabelText(/Ouverture/))).toBe('07:00')
    expect(checked(within(day(dialog, 'Samedi')).getByRole('checkbox', { name: 'Ouvert' }))).toBe(false)
    expect(within(day(dialog, 'Samedi')).getByText('Fermé toute la journée')).toBeTruthy()

    await user.click(within(day(dialog, 'Samedi')).getByRole('checkbox', { name: 'Ouvert' }))
    await user.type(within(day(dialog, 'Samedi')).getByLabelText(/Ouverture/), '09:00')
    await user.type(within(day(dialog, 'Samedi')).getByLabelText(/Fermeture/), '12:30')
    const statusReads = lockerGateway.getStatus.mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(gateway.putSchedule).toHaveBeenCalledTimes(1)
    const [, lockerId, request] = gateway.putSchedule.mock.calls[0]!
    expect(lockerId).toBe(DEMO_LOCKER_ID)
    expect(request).toEqual({ timeZone: 'America/Toronto', windows: saved.windows })
    expect(gateway.putSchedule.mock.calls[0]).toHaveLength(3)
    await waitFor(() => expect(lockerGateway.getStatus.mock.calls.length).toBeGreaterThan(statusReads))
    expect(screen.getByText('Horaire du casier AEGIS-DEMO-01 enregistré.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Modifier l’horaire' }))
  })

  it('reads the schedule again at each opening, so a cancelled draft is not kept', async () => {
    const gateway = fakeScheduleGateway([okSchedule(scheduleView())])
    renderLockers(gateway)
    const { user, dialog } = await openEditor()
    await user.click(await within(day(dialog, 'Lundi')).findByRole('checkbox', { name: 'Ouvert' }))
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const again = await openEditor()
    expect(checked(await within(day(again.dialog, 'Lundi')).findByRole('checkbox', { name: 'Ouvert' }))).toBe(true)
    expect(gateway.getSchedule).toHaveBeenCalledTimes(2)
    expect(gateway.putSchedule).not.toHaveBeenCalled()
  })

  it('starts closed with the locker zone when nothing is configured, and checks an open day before sending', async () => {
    const gateway = fakeScheduleGateway([problem(404, 'OPERATING_SCHEDULE_NOT_CONFIGURED')])
    renderLockers(gateway)
    const { user, dialog } = await openEditor()
    expect(await within(dialog).findByText(/Aucun horaire n’est configuré/)).toBeTruthy()
    expect(value(within(dialog).getByRole('textbox', { name: /Fuseau horaire/ }))).toBe('America/Toronto')
    expect(within(dialog).getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true)

    await user.click(within(day(dialog, 'Lundi')).getByRole('checkbox', { name: 'Ouvert' }))
    await user.type(within(day(dialog, 'Lundi')).getByLabelText(/Ouverture/), '18:00')
    await user.type(within(day(dialog, 'Lundi')).getByLabelText(/Fermeture/), '08:00')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    const closes = within(day(dialog, 'Lundi')).getByLabelText(/Fermeture/)
    expect(closes.getAttribute('aria-invalid')).toBe('true')
    expect(description(closes)).toMatch(/La fermeture doit suivre l’ouverture/)
    await waitFor(() => expect(document.activeElement).toBe(closes))
    expect(gateway.putSchedule).not.toHaveBeenCalled()
  })

  it('puts the server violations on their day and the zone, and keeps the draft', async () => {
    const violations = [
      { field: 'timeZone', code: 'INVALID_VALUE' },
      { field: 'windows[5].closesAt', code: 'NOT_AFTER_OPENS_AT' },
    ]
    const gateway = fakeScheduleGateway([okSchedule(scheduleView({ timeZone: 'America/Toronto' }))], [problem(400, 'VALIDATION_ERROR', { violations })])
    renderLockers(gateway)
    const { user, dialog } = await openEditor()
    const zone = await within(dialog).findByRole('textbox', { name: /Fuseau horaire/ })
    await user.clear(zone)
    await user.type(zone, 'Mars/Olympus')
    await user.click(within(day(dialog, 'Samedi')).getByRole('checkbox', { name: 'Ouvert' }))
    await user.type(within(day(dialog, 'Samedi')).getByLabelText(/Ouverture/), '10:00')
    await user.type(within(day(dialog, 'Samedi')).getByLabelText(/Fermeture/), '11:00')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    expect(await within(dialog).findByText('Valeur non reconnue par le serveur.')).toBeTruthy()
    expect(zone.getAttribute('aria-invalid')).toBe('true')
    expect(value(zone)).toBe('Mars/Olympus')
    expect(description(within(day(dialog, 'Samedi')).getByLabelText(/Fermeture/))).toMatch(/La fermeture doit suivre l’ouverture/)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('reports a failed read without an editable form, and reads again on request', async () => {
    const gateway = fakeScheduleGateway([{ kind: 'network', reason: 'offline' }, okSchedule(scheduleView())])
    renderLockers(gateway)
    const { user, dialog } = await openEditor()
    expect(await within(dialog).findByText('L’horaire n’a pas pu être lu.')).toBeTruthy()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Réessayer' }))
    expect(value(await within(dialog).findByRole('textbox', { name: /Fuseau horaire/ }))).toBe('America/Toronto')
  })

  it('shows a business refusal from the server in the form alert, without closing', async () => {
    const gateway = fakeScheduleGateway([okSchedule(scheduleView())], [problem(404, 'RESOURCE_NOT_FOUND')])
    renderLockers(gateway)
    const { user, dialog } = await openEditor()
    await within(dialog).findByRole('textbox', { name: /Fuseau horaire/ })
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toMatch(/n’existe plus/)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('speaks English', async () => {
    const gateway = fakeScheduleGateway([okSchedule(scheduleView())])
    renderLockers(gateway, { locale: 'en' })
    const { dialog } = await openEditor('Edit schedule')
    expect(within(dialog).getByRole('heading', { name: 'Operating schedule of locker AEGIS-DEMO-01' })).toBeTruthy()
    expect(value(await within(dialog).findByRole('textbox', { name: /Time zone/ }))).toBe('America/Toronto')
    expect(within(day(dialog, 'Sunday')).getByText('Closed all day')).toBeTruthy()
    expect(value(within(day(dialog, 'Monday')).getByLabelText(/Opens/))).toBe('07:00')
  })
})
