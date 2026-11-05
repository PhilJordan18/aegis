import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway, type GatewayResult } from '../features/auth/authGateway'
import type { UserProfile } from '../features/auth/contract'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody, technicianProfile } from '../features/auth/testFixtures'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

function gatewayAnswering(...results: GatewayResult<UserProfile>[]): AuthGateway & { currentProfile: ReturnType<typeof vi.fn> } {
  const currentProfile = vi.fn(async () => results.shift() ?? { kind: 'network' as const, reason: 'offline' as const })
  return { ...unconfiguredAuthGateway, currentProfile }
}

/** The sign-in page's information alert (role="status"), distinct from its visually hidden live region. */
function arrivalAlert(): string {
  return (document.querySelector('.ag-alert[role="status"]')?.textContent ?? '')
}

function signedInSession(expiresIn = 3600) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn, profile: adminProfile })
  return session
}

function renderProtected(gateway: AuthGateway, session = signedInSession()) {
  window.history.replaceState(null, '', '/equipements')
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway, session, queryClient })
}

beforeEach(() => {
  installMatchMedia(window, false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('protected Équipements page', () => {
  it('sends a visitor without a session to sign-in without a message or a request', async () => {
    const gateway = gatewayAnswering()
    renderProtected(gateway, createSessionStore())
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(screen.getByRole('heading', { level: 1, name: 'Connexion' })).toBeDefined()
    expect(screen.queryByRole('status', { name: /session/ })).toBeNull()
    expect(gateway.currentProfile).not.toHaveBeenCalled()
  })

  it('shows the shell with the session profile, then the profile confirmed by GET /auth/me', async () => {
    const gateway = gatewayAnswering({ kind: 'ok', value: { ...adminProfile, displayName: 'Nom confirmé' }, requestId: null })
    renderProtected(gateway)
    expect(document.title).toBe('Équipements — Aegis Manager')
    expect(screen.getByRole('heading', { level: 1, name: 'Équipements' })).toBeDefined()
    expect(screen.getAllByText(adminProfile.displayName).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getAllByText('Nom confirmé').length).toBeGreaterThan(0))
    expect(gateway.currentProfile).toHaveBeenCalledTimes(1)
    expect(gateway.currentProfile.mock.calls[0]?.[0]).toBe('token-value')
    const nav = screen.getAllByRole('navigation', { name: 'Sections' })[0]
    expect(nav).toBeDefined()
  })

  it.each([
    ['AUTH_TOKEN_EXPIRED', 'Votre session a expiré. Reconnectez-vous.'],
    ['AUTH_TOKEN_INVALID', "Votre session n'est plus valide. Reconnectez-vous."],
  ])('a 401 %s returns to sign-in with that state, email prefilled and focus on the password', async (code, title) => {
    const gateway = gatewayAnswering({ kind: 'httpProblem', status: 401, problem: problemBody(401, code), retryAfter: null, requestId: null })
    const { session } = renderProtected(gateway)
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(session.getAccessToken()).toBeNull()
    expect(arrivalAlert()).toContain(title)
    expect(screen.getByLabelText('Adresse courriel')).toHaveProperty('value', adminProfile.email)
    expect(document.activeElement).toBe(screen.getByLabelText('Mot de passe'))
  })

  it('an account that is no longer an administrator is signed out as invalid', async () => {
    const gateway = gatewayAnswering({ kind: 'ok', value: technicianProfile, requestId: null })
    renderProtected(gateway)
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(arrivalAlert()).toContain("Votre session n'est plus valide.")
  })

  it('token expiry (no refresh) returns to sign-in with the expired-session state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const gateway = gatewayAnswering({ kind: 'ok', value: adminProfile, requestId: null })
    const { session } = renderProtected(gateway, signedInSession(3600))
    await waitFor(() => expect(gateway.currentProfile).toHaveBeenCalledTimes(1))
    expect(window.location.pathname).toBe('/equipements')

    await act(async () => {
      vi.advanceTimersByTime(3600 * 1000)
    })
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(session.getAccessToken()).toBeNull()
    expect(arrivalAlert()).toContain('Votre session a expiré. Reconnectez-vous.')
    expect(screen.getByLabelText('Adresse courriel')).toHaveProperty('value', adminProfile.email)
  })

  it('« Se déconnecter » drops the token and the cached profile', async () => {
    const gateway = gatewayAnswering({ kind: 'ok', value: adminProfile, requestId: null })
    const { session, queryClient } = renderProtected(gateway)
    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: ['auth', 'currentProfile'] })?.state.status).toBe('success'))
    const user = userEvent.setup()
    const trigger = screen.getAllByRole('button', { name: new RegExp(adminProfile.displayName) })[0] as HTMLElement
    await user.click(trigger)
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement
    await user.click(within(panel).getByRole('button', { name: 'Se déconnecter' }))
    await waitFor(() => expect(window.location.pathname).toBe('/connexion'))
    expect(session.getAccessToken()).toBeNull()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(arrivalAlert()).toContain('Vous êtes déconnecté.')
  })
})
