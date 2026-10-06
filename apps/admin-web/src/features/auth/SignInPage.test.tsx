import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMatchMedia } from '../../test/matchMedia'
import { renderWithProviders } from '../../test/renderApp'
import type { AuthGateway, GatewayResult } from './authGateway'
import type { LoginResponse, UserProfile } from './contract'
import { createSessionStore } from './session'
import { signInCopy } from './signInCopy'
import { SignInPage } from './SignInPage'
import { SIGN_IN_TIMEOUT_MS, validateSignIn } from './signInValidation'
import { adminProfile, httpProblem, loginOk, problemBody, technicianProfile } from './testFixtures'

const { approved, proposed } = signInCopy
const SERVER_TEXT = 'SERVER-SUPPLIED TEXT THAT MUST NEVER BE SHOWN'

function gatewayReturning(result: GatewayResult<LoginResponse> | Promise<GatewayResult<LoginResponse>>) {
  const signIn = vi.fn<AuthGateway['signIn']>(async () => result)
  const currentProfile = vi.fn<AuthGateway['currentProfile']>()
  return { gateway: { signIn, currentProfile } satisfies AuthGateway, signIn, currentProfile }
}

const emailField = () => screen.getByLabelText(approved.emailLabel) as HTMLInputElement
const passwordField = () => screen.getByLabelText(approved.passwordLabel, { selector: 'input' }) as HTMLInputElement
const submitButton = () => screen.getByRole('button', { name: new RegExp(`^(${approved.submit}|${proposed.submitting})$`) })

async function fillAndSubmit(user = userEvent.setup(), email = 'admin@aegis.test', password = 'mot-de-passe-test') {
  await user.type(emailField(), email)
  await user.type(passwordField(), password)
  await user.click(submitButton())
  return user
}

function describedBy(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')
}

beforeEach(() => {
  installMatchMedia(window, false)
  window.history.replaceState(null, '', '/connexion')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('validateSignIn', () => {
  it('returns the proposed messages for each client error', () => {
    expect(validateSignIn('', '')).toEqual({ email: proposed.emailRequired, password: proposed.passwordRequired })
    expect(validateSignIn('admin@aegis', 'x')).toEqual({ email: proposed.emailInvalid })
    expect(validateSignIn(`${'a'.repeat(315)}@b.test`, 'x')).toEqual({ email: proposed.emailTooLong })
    expect(validateSignIn('  admin@aegis.demo ', 'x')).toEqual({})
  })
})

describe('SignInPage — idle and client validation', () => {
  it('renders the approved structure and focuses the email field on arrival', () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />)
    expect(screen.getByRole('heading', { level: 1, name: approved.heading })).toBeDefined()
    expect(document.activeElement).toBe(emailField())
    expect(emailField().getAttribute('autocomplete')).toBe('username')
    expect(emailField().getAttribute('autocapitalize')).toBe('none')
    expect(passwordField().getAttribute('autocomplete')).toBe('current-password')
    expect(passwordField().hasAttribute('maxlength')).toBe(false)
    expect(screen.getByText(approved.accountNote)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/Créer un compte|Mot de passe oublié/)).toBeNull()
  })

  it('sends no request, marks the fields and focuses the first invalid one', async () => {
    const { gateway, signIn } = gatewayReturning(loginOk(adminProfile))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    const user = userEvent.setup()
    await user.click(submitButton())

    expect(signIn).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(emailField())
    expect(emailField().getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(emailField())).toBe(proposed.emailRequired)
    expect(describedBy(passwordField())).toBe(proposed.passwordRequired)
    expect(screen.queryByRole('alert')).toBeNull()

    await user.type(emailField(), 'admin@aegis.demo')
    expect(emailField().hasAttribute('aria-invalid')).toBe(false)
  })
})

describe('SignInPage — submission', () => {
  it('shows a busy, aria-disabled button, read-only fields, and ignores a second submit', async () => {
    let release: (value: GatewayResult<LoginResponse>) => void = () => {}
    const { gateway, signIn } = gatewayReturning(new Promise((resolve) => (release = resolve)))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    const user = await fillAndSubmit()

    const button = submitButton()
    expect(button.textContent).toBe(proposed.submitting)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(emailField().readOnly).toBe(true)
    expect(passwordField().readOnly).toBe(true)
    expect(screen.getByText(proposed.submittingStatus).getAttribute('role')).toBe('status')

    await user.click(button)
    await user.keyboard('{Enter}')
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(signIn.mock.calls[0]?.[0]).toEqual({ email: 'admin@aegis.test', password: 'mot-de-passe-test' })

    await act(async () => release(httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS'))))
    expect(submitButton().hasAttribute('aria-disabled')).toBe(false)
  })

  it('refused credentials: error alert, password cleared and focused, described by the alert, no server text', async () => {
    const { gateway } = gatewayReturning(
      httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS', { title: SERVER_TEXT, detail: SERVER_TEXT })),
    )
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${approved.invalidCredentialsTitle}${proposed.invalidCredentialsBody}`)
    expect(document.activeElement).toBe(passwordField())
    expect(passwordField().value).toBe('')
    expect(emailField().value).toBe('admin@aegis.test')
    expect(passwordField().getAttribute('aria-describedby')).toContain(alert.id)
    expect(document.body.textContent).not.toContain(SERVER_TEXT)
  })

  it('maps server field violations by field, never by their message', async () => {
    const violations = [{ field: 'email', code: 'INVALID_FORMAT', message: SERVER_TEXT }]
    const { gateway } = gatewayReturning(httpProblem(400, problemBody(400, 'VALIDATION_ERROR', { violations })))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()

    await waitFor(() => expect(emailField().getAttribute('aria-invalid')).toBe('true'))
    expect(describedBy(emailField())).toBe(proposed.emailInvalid)
    expect(document.activeElement).toBe(emailField())
    expect(document.body.textContent).not.toContain(SERVER_TEXT)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says a typed password was not accepted when the server rejects it (R5)', async () => {
    const violations = [{ field: 'password', code: 'INVALID', message: SERVER_TEXT }]
    const { gateway } = gatewayReturning(httpProblem(400, problemBody(400, 'VALIDATION_ERROR', { violations })))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()
    await waitFor(() => expect(passwordField().getAttribute('aria-invalid')).toBe('true'))
    expect(describedBy(passwordField())).toBe(proposed.passwordRejected)
    expect(document.activeElement).toBe(passwordField())
  })

  it('shows the generic alert for an unknown violated field', async () => {
    const violations = [{ field: 'tenant', code: 'UNKNOWN', message: SERVER_TEXT }]
    const { gateway } = gatewayReturning(httpProblem(400, problemBody(400, 'VALIDATION_ERROR', { violations })))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()
    expect((await screen.findByRole('alert')).textContent).toBe(proposed.validationUnknown)
  })

  it('keeps both values when the service is unreachable', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />)
    await fillAndSubmit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${approved.unreachableTitle}${proposed.unreachableBody}`)
    expect(alert.className).toContain('ag-alert--warning')
    expect(emailField().value).toBe('admin@aegis.test')
    expect(passwordField().value).toBe('mot-de-passe-test')
  })

  it('shows only the traceId of an unexpected server error', async () => {
    const { gateway } = gatewayReturning(httpProblem(500, problemBody(500, 'INTERNAL_ERROR', { detail: SERVER_TEXT })))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()
    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('code')?.textContent).toBe('5f4bc22e-66a4-48ef-8bf3-6e7184d71c30')
    expect(alert.textContent).toContain(proposed.serviceErrorTitle)
    expect(document.body.textContent).not.toContain(SERVER_TEXT)
  })

  it('abandons a request after 15 s and reports the service as unreachable', async () => {
    vi.useFakeTimers()
    const signIn = vi.fn<AuthGateway['signIn']>(
      (_request, signal) => new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ kind: 'aborted' }))),
    )
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway: { signIn, currentProfile: vi.fn() } })
    fireEvent.change(emailField(), { target: { value: 'admin@aegis.test' } })
    fireEvent.change(passwordField(), { target: { value: 'x' } })
    await act(async () => fireEvent.click(submitButton()))
    expect(submitButton().textContent).toBe(proposed.submitting)

    await act(async () => vi.advanceTimersByTime(SIGN_IN_TIMEOUT_MS))
    expect(screen.getByRole('alert').textContent).toContain(approved.unreachableTitle)
  })
})

describe('SignInPage — rate limit', () => {
  it('locks submission with a countdown outside the live region, then re-enables and announces once', async () => {
    vi.useFakeTimers()
    const { gateway, signIn } = gatewayReturning(httpProblem(429, problemBody(429, 'RATE_LIMITED'), '3'))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    fireEvent.change(emailField(), { target: { value: 'admin@aegis.test' } })
    fireEvent.change(passwordField(), { target: { value: 'x' } })
    await act(async () => fireEvent.click(submitButton()))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(`${approved.rateLimitedTitle}${proposed.rateLimitedBody(3)}`)
    const hint = screen.getByText(proposed.rateLimitedHint('0:03'))
    expect(hint.closest('[role="alert"], [role="status"], [aria-live]')).toBeNull()
    expect(submitButton().getAttribute('aria-disabled')).toBe('true')
    expect(describedBy(submitButton())).toContain(proposed.rateLimitedHint('0:03'))

    await act(async () => fireEvent.click(submitButton()))
    expect(signIn).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.getByText(proposed.rateLimitedHint('0:02'))).toBeDefined()
    expect(alert.textContent).toContain(proposed.rateLimitedBody(3))

    await act(async () => vi.advanceTimersByTime(2000))
    expect(submitButton().hasAttribute('aria-disabled')).toBe(false)
    expect(screen.queryByText(/Disponible dans/)).toBeNull()
    // R4: back to idle, the stale alert is gone and the only announcement is the polite status.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(proposed.rateLimitedBody(3))).toBeNull()
    expect(document.querySelector('form')?.getAttribute('data-state')).toBe('idle')
    expect(screen.getByText(proposed.rateLimitedReady).getAttribute('role')).toBe('status')
  })

  it('falls back to the approved copy and does not lock without Retry-After', async () => {
    const { gateway } = gatewayReturning(httpProblem(429, null))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()
    expect((await screen.findByRole('alert')).textContent).toBe(`${approved.rateLimitedTitle}${approved.rateLimitedFallback}`)
    expect(submitButton().hasAttribute('aria-disabled')).toBe(false)
  })
})

describe('SignInPage — role and session', () => {
  it('replaces the form for a technician, keeps no token, calls no route, and focuses the heading', async () => {
    const { gateway, currentProfile } = gatewayReturning(loginOk(technicianProfile, 'technician-token'))
    const { session } = renderWithProviders(<SignInPage afterSignInPath="/apercu" />, { gateway })
    const user = await fillAndSubmit()

    const heading = await screen.findByRole('heading', { level: 1, name: proposed.roleHeading })
    expect(document.activeElement).toBe(heading)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelector('form')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(`${approved.technicianAccount}${proposed.roleBody}`)
    expect(screen.getByText('admin@aegis.test')).toBeDefined()
    expect(session.getAccessToken()).toBeNull()
    expect(session.getSnapshot().status).toBe('anonymous')
    expect(currentProfile).not.toHaveBeenCalled()
    expect(document.body.innerHTML).not.toContain('technician-token')
    expect(window.location.pathname).toBe('/connexion')

    await user.click(screen.getByRole('button', { name: proposed.roleRetry }))
    expect(screen.getByRole('heading', { level: 1, name: approved.heading })).toBeDefined()
    expect(document.activeElement).toBe(emailField())
    expect(emailField().value).toBe('')
    expect(passwordField().value).toBe('')
  })

  it('uses the unknown-role title for a role this client does not know', async () => {
    const auditor = { ...adminProfile, role: 'AUDITOR' } as unknown as UserProfile
    const { gateway } = gatewayReturning(loginOk(auditor))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    await fillAndSubmit()
    expect((await screen.findByRole('alert')).textContent).toContain(proposed.roleUnknownTitle)
  })

  it('starts an administrator session in memory and navigates', async () => {
    const { gateway } = gatewayReturning(loginOk(adminProfile, 'admin-token'))
    const { session } = renderWithProviders(<SignInPage afterSignInPath="/apres" />, { gateway })
    await fillAndSubmit()
    await waitFor(() => expect(window.location.pathname).toBe('/apres'))
    expect(session.getAccessToken()).toBe('admin-token')
  })

  it('after an expired session: info status, email prefilled, password focused and described by the alert', async () => {
    const session = createSessionStore()
    session.end('sessionExpired', 'admin@aegis.demo')
    renderWithProviders(<SignInPage afterSignInPath="/" />, { session })

    const status = screen.getByText(approved.sessionExpiredTitle).closest('[role]')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.textContent).toContain(proposed.sessionExpiredBody)
    expect(emailField().value).toBe('admin@aegis.demo')
    expect(document.activeElement).toBe(passwordField())
    expect(passwordField().getAttribute('aria-describedby')).toContain(status?.id)
  })

  it('after an invalid session: its own information', () => {
    const session = createSessionStore()
    session.end('sessionInvalid', 'admin@aegis.demo')
    renderWithProviders(<SignInPage afterSignInPath="/" />, { session })
    expect(screen.getByText(proposed.sessionInvalidTitle).closest('[role]')?.getAttribute('role')).toBe('status')
    expect(document.activeElement).toBe(passwordField())
  })

  it('after a sign-out: title-only information, empty fields, email focused', () => {
    const session = createSessionStore()
    session.signOut()
    renderWithProviders(<SignInPage afterSignInPath="/" />, { session })
    expect(screen.getByText(proposed.signedOutTitle).closest('[role]')?.getAttribute('role')).toBe('status')
    expect(emailField().value).toBe('')
    expect(document.activeElement).toBe(emailField())
  })
})

describe('SignInPage — password visibility', () => {
  it('toggles with an announced, labelled button and masks again before each submit', async () => {
    const { gateway } = gatewayReturning(httpProblem(500, null))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { gateway })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: proposed.revealLabel }))
    expect(passwordField().type).toBe('text')
    expect(screen.getByText(proposed.revealedStatus).getAttribute('role')).toBe('status')
    const conceal = screen.getByRole('button', { name: proposed.concealLabel })
    expect(conceal.textContent).toBe(proposed.conceal)
    expect(document.activeElement).toBe(conceal)

    await fillAndSubmit(user)
    expect(passwordField().type).toBe('password')
  })
})
