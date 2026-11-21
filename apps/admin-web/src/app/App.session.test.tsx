import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unconfiguredAuthGateway, type AuthGateway, type GatewayResult } from '../features/auth/authGateway'
import type { LoginResponse } from '../features/auth/contract'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, httpProblem, loginOk, problemBody } from '../features/auth/testFixtures'
import { fr } from '../i18n/messages/fr'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'
import { App } from './App'

const t = fr.session

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

const refused = (): GatewayResult<LoginResponse> => httpProblem(401, problemBody(401, 'AUTH_SESSION_INVALID'))
const revoked: GatewayResult<true> = { kind: 'ok', value: true, requestId: null }

function gatewayWith(overrides: Partial<AuthGateway>): AuthGateway {
  return {
    ...unconfiguredAuthGateway,
    currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }),
    ...overrides,
  }
}

/** The page as the browser loads it: the store restores before the first render, like main.tsx. */
function boot(path: string, gateway: AuthGateway) {
  window.history.replaceState(null, '', path)
  const session = createSessionStore()
  session.connect(gateway)
  const restoring = session.restore()
  const view = renderWithProviders(<App />, { gateway, session })
  return { ...view, restoring }
}

const where = () => `${window.location.pathname}${window.location.search}`

beforeEach(() => {
  installMatchMedia(window, false)
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('boot restoration of a protected page (ADR-016)', () => {
  it('waits for the refresh without redirecting, then shows the requested page at the same address', async () => {
    const answer = deferred<GatewayResult<LoginResponse>>()
    const refreshSession = vi.fn(() => answer.promise)
    const { restoring } = boot('/casiers?salle=A', gatewayWith({ refreshSession }))

    expect(screen.getByRole('heading', { level: 1, name: t.restoringHeading })).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(t.restoringStatus)
    expect(where()).toBe('/casiers?salle=A')
    expect(screen.queryByLabelText('Adresse courriel')).toBeNull()

    await act(async () => {
      answer.resolve(loginOk(adminProfile, 'restored-token'))
      await restoring
    })
    expect(screen.queryByRole('heading', { name: t.restoringHeading })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Administratrice Test/ }).length).toBeGreaterThan(0)
    expect(where()).toBe('/casiers?salle=A')
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('sends a 401 to the sign-in page once, remembering the page, and comes back to it after signing in', async () => {
    const signIn = vi.fn(async () => loginOk(adminProfile, 'fresh-token'))
    const refreshSession = vi.fn(async () => refused())
    const { restoring } = boot('/reservations-prets?statut=ACTIVE', gatewayWith({ refreshSession, signIn }))
    await act(async () => {
      await restoring
    })

    expect(where()).toBe('/connexion?retour=%2Freservations-prets%3Fstatut%3DACTIVE')
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Adresse courriel')).toBeDefined()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Adresse courriel'), 'admin@aegis.test')
    await user.type(screen.getByLabelText('Mot de passe', { selector: 'input' }), 'mot-de-passe-test')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))

    await waitFor(() => expect(where()).toBe('/reservations-prets?statut=ACTIVE'))
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('ignores an unsafe return path in the address and lands on the default page', async () => {
    const signIn = vi.fn(async () => loginOk(adminProfile, 'fresh-token'))
    const { restoring } = boot('/connexion?retour=%2F%2Fevil.example%2Fcasiers', gatewayWith({ refreshSession: async () => refused(), signIn }))
    await act(async () => {
      await restoring
    })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Adresse courriel'), 'admin@aegis.test')
    await user.type(screen.getByLabelText('Mot de passe', { selector: 'input' }), 'mot-de-passe-test')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() => expect(where()).not.toContain('/connexion'))
    expect(where()).not.toContain('evil')
  })

  it('leaves for the requested page when the restoration succeeds behind the sign-in page', async () => {
    const answer = deferred<GatewayResult<LoginResponse>>()
    const { restoring } = boot('/connexion?retour=%2Fanomalies', gatewayWith({ refreshSession: () => answer.promise }))
    expect(screen.getByLabelText('Adresse courriel')).toBeDefined()

    await act(async () => {
      answer.resolve(loginOk(adminProfile))
      await restoring
    })
    expect(where()).toBe('/anomalies')
  })

  it('does not decide for the server when it cannot be reached: an alert with a retry, then the page', async () => {
    const refreshSession = vi
      .fn<AuthGateway['refreshSession']>()
      .mockResolvedValueOnce({ kind: 'network', reason: 'offline' })
      .mockResolvedValueOnce(loginOk(adminProfile))
    const { restoring } = boot('/audit', gatewayWith({ refreshSession }))
    await act(async () => {
      await restoring
    })

    expect(where()).toBe('/audit')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(t.unreachableTitle)
    expect(alert.textContent).toContain(t.unreachableBody)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: t.restoringHeading }))
    const signInLink = screen.getByRole('link', { name: t.signInInstead })
    expect(signInLink.getAttribute('href')).toBe('/connexion?retour=%2Faudit')

    await userEvent.setup().click(screen.getByRole('button', { name: t.retry }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Administratrice Test/ }).length).toBeGreaterThan(0))
    expect(where()).toBe('/audit')
    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('shows a forbidden view for a 403, without signing anyone out, with a retry', async () => {
    const forbidden = httpProblem(403, problemBody(403, 'FORBIDDEN', { traceId: 'trace-403' }))
    const refreshSession = vi.fn<AuthGateway['refreshSession']>().mockResolvedValueOnce(forbidden).mockResolvedValueOnce(loginOk(adminProfile))
    const revokeSession = vi.fn(async () => revoked)
    const { restoring, session } = boot('/audit', gatewayWith({ refreshSession, revokeSession }))
    await act(async () => {
      await restoring
    })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(t.forbiddenTitle)
    expect(within(alert).getByText('trace-403')).toBeDefined()
    expect(where()).toBe('/audit')
    expect(revokeSession).not.toHaveBeenCalled()
    expect(session.getSnapshot().status).toBe('restoreFailed')

    await userEvent.setup().click(screen.getByRole('button', { name: t.retry }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Administratrice Test/ }).length).toBeGreaterThan(0))
  })

  it('shows the trace id of a service error', async () => {
    const failure = httpProblem(503, problemBody(503, 'INTERNAL_ERROR', { traceId: 'trace-123' }))
    const { restoring } = boot('/audit', gatewayWith({ refreshSession: async () => failure }))
    await act(async () => {
      await restoring
    })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(t.serviceErrorTitle)
    expect(within(alert).getByText('trace-123')).toBeDefined()
  })
})

describe('session end while using the page', () => {
  it('sends an expired session to the sign-in page once, remembering the page', async () => {
    const refreshSession = vi.fn(async () => refused())
    const gateway = gatewayWith({ refreshSession })
    window.history.replaceState(null, '', '/audit')
    const session = createSessionStore()
    session.connect(gateway)
    session.start({ accessToken: 'token', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    renderWithProviders(<App />, { gateway, session })
    expect(screen.getAllByRole('button', { name: /Administratrice Test/ }).length).toBeGreaterThan(0)

    await act(async () => {
      expect(await session.renew('token', 'sessionExpired')).toEqual({ kind: 'ended' })
    })
    expect(where()).toBe('/connexion?retour=%2Faudit')
    expect(screen.getByText(fr.signIn.sessionExpiredTitle)).toBeDefined()
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })
})

describe('explicit sign-out (ADR-016)', () => {
  async function signedInAt(path: string, gateway: AuthGateway) {
    window.history.replaceState(null, '', path)
    const session = createSessionStore()
    session.connect(gateway)
    session.start({ accessToken: 'token', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    const view = renderWithProviders(<App />, { gateway, session })
    const user = userEvent.setup()
    const account = screen.getAllByRole('button', { name: /Administratrice Test/ })[0] as HTMLElement
    await user.click(account)
    return { ...view, user, account }
  }

  it('revokes on the server, then leaves for the sign-in page without remembering the page', async () => {
    const revokeSession = vi.fn(async () => revoked)
    const { user, session } = await signedInAt('/casiers', gatewayWith({ revokeSession }))
    await user.click(screen.getAllByRole('button', { name: fr.shell.signOut })[0] as HTMLElement)

    await waitFor(() => expect(where()).toBe('/connexion'))
    expect(revokeSession).toHaveBeenCalledTimes(1)
    expect(session.getAccessToken()).toBeNull()
    expect(screen.getByText(fr.signIn.signedOutTitle)).toBeDefined()
  })

  it('keeps the session and says so when the server did not confirm, then signs out on retry', async () => {
    const revokeSession = vi
      .fn<AuthGateway['revokeSession']>()
      .mockResolvedValueOnce({ kind: 'network', reason: 'offline' })
      .mockResolvedValueOnce(revoked)
    const { user, session } = await signedInAt('/casiers', gatewayWith({ revokeSession }))
    await user.click(screen.getAllByRole('button', { name: fr.shell.signOut })[0] as HTMLElement)

    const alert = await screen.findByRole('alert')
    // Exactly this sentence, in both languages (catalog parity), and a retry; nothing else is said.
    expect(alert.textContent).toBe(`${t.signOutFailedTitle}${t.signOutRetry}`)
    expect(t.signOutFailedTitle).toBe('Impossible de confirmer la déconnexion. Réessayez.')
    expect(session.getSnapshot().status).toBe('authenticated')
    expect(session.getAccessToken()).toBe('token')
    expect(where()).toBe('/casiers')

    await user.click(within(alert).getByRole('button', { name: t.signOutRetry }))
    await waitFor(() => expect(where()).toBe('/connexion'))
    expect(revokeSession).toHaveBeenCalledTimes(2)
    expect(session.getAccessToken()).toBeNull()
  })
})
