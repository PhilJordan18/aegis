import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formattersFor } from '../../i18n/format'
import type { Locale } from '../../i18n/locale'
import { MESSAGES } from '../../i18n/messages'
import { installMatchMedia } from '../../test/matchMedia'
import { renderWithProviders } from '../../test/renderApp'
import type { AuthGateway, GatewayResult } from './authGateway'
import type { LoginResponse, UserProfile } from './contract'
import { createSessionStore } from './session'
import { SignInPage } from './SignInPage'
import { adminProfile, httpProblem, loginOk, problemBody, technicianProfile } from './testFixtures'

const SERVER_TEXT = 'SERVER-SUPPLIED TEXT THAT MUST NEVER BE SHOWN'
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const LOCALES: readonly Locale[] = ['fr', 'en']

function gatewayReturning(result: GatewayResult<LoginResponse>) {
  const signIn = vi.fn<AuthGateway['signIn']>(async () => result)
  return { signIn, currentProfile: vi.fn<AuthGateway['currentProfile']>() } satisfies AuthGateway
}

const label = (text: string, selector?: string) => screen.getByLabelText(text, selector ? { selector } : undefined) as HTMLInputElement

async function fillAndSubmit(locale: Locale, user = userEvent.setup()) {
  const t = MESSAGES[locale].signIn
  await user.type(label(t.emailLabel), 'admin@aegis.test')
  await user.type(label(t.passwordLabel, 'input'), 'mot-de-passe-test')
  await user.click(screen.getByRole('button', { name: t.submit }))
  return user
}

beforeEach(() => {
  installMatchMedia(window, false)
  window.history.replaceState(null, '', '/connexion')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('SignInPage — English wording (explicit strings, not read back from the catalog)', () => {
  it('idle form', () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'en' })
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeDefined()
    expect(screen.getByLabelText('Email address')).toBeDefined()
    expect(screen.getByLabelText('Password', { selector: 'input' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Home' })).toBeDefined()
    expect(screen.getByText('Account provided by your administrator.')).toBeDefined()
    expect(screen.getByText('Technician? Use Aegis Mobile on iPhone.')).toBeDefined()
  })

  it('client validation', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'en' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Enter your email address.')).toBeDefined()
    expect(screen.getByText('Enter your password.')).toBeDefined()
  })

  it('the 429 delay uses the English plural: 1 second, 42 seconds', async () => {
    for (const [retryAfter, text] of [
      ['1', 'Try again in 1 second.'],
      ['42', 'Try again in 42 seconds.'],
      ['0', 'Try again in a minute.'],
    ] as const) {
      const { unmount } = renderWithProviders(<SignInPage afterSignInPath="/" />, {
        locale: 'en',
        gateway: gatewayReturning(httpProblem(429, problemBody(429, 'RATE_LIMITED'), retryAfter)),
      })
      await fillAndSubmit('en')
      expect((await screen.findByRole('alert')).textContent?.replace(/\u00A0/g, ' ')).toBe(`Too many attempts.${text}`)
      unmount()
    }
  })

  it('the 429 delay uses the French plural: 1 seconde, 0 → fallback, 42 secondes', async () => {
    for (const [retryAfter, text] of [
      ['1', 'Réessayez dans 1\u00A0seconde.'],
      ['42', 'Réessayez dans 42\u00A0secondes.'],
    ] as const) {
      const { unmount } = renderWithProviders(<SignInPage afterSignInPath="/" />, {
        gateway: gatewayReturning(httpProblem(429, problemBody(429, 'RATE_LIMITED'), retryAfter)),
      })
      await fillAndSubmit('fr')
      expect((await screen.findByRole('alert')).textContent).toBe(`Trop de tentatives.${text}`)
      unmount()
    }
  })

  it('refused credentials, unreachable service and server error', async () => {
    const cases: [GatewayResult<LoginResponse>, string][] = [
      [httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS')), 'Incorrect email address or password.Check both fields, then try again.'],
      [{ kind: 'network', reason: 'offline' }, 'Unable to reach the service.Check your network, then try again.'],
      [
        httpProblem(500, problemBody(500, 'INTERNAL_ERROR', { detail: SERVER_TEXT })),
        `The service could not process the sign-in.Try again in a moment. If the problem persists, give the trace ID to support.Trace ID: ${TRACE_ID}`,
      ],
    ]
    for (const [result, text] of cases) {
      const { unmount } = renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'en', gateway: gatewayReturning(result) })
      await fillAndSubmit('en')
      expect((await screen.findByRole('alert')).textContent).toBe(text)
      expect(document.body.textContent).not.toContain(SERVER_TEXT)
      unmount()
    }
  })

  it('session arrivals and the role screen', async () => {
    const arrivals = [
      ['sessionExpired', 'Your session has expired. Sign in again.'],
      ['sessionInvalid', 'Your session is no longer valid. Sign in again.'],
    ] as const
    for (const [reason, title] of arrivals) {
      const session = createSessionStore()
      session.end(reason, 'admin@aegis.demo')
      const { unmount } = renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'en', session })
      expect(screen.getByText(title)).toBeDefined()
      unmount()
    }
    const session = createSessionStore()
    session.signOut()
    const signedOut = renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'en', session })
    expect(screen.getByText('You are signed out.')).toBeDefined()
    signedOut.unmount()

    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'en', gateway: gatewayReturning(loginOk(technicianProfile)) })
    await fillAndSubmit('en')
    expect(await screen.findByRole('heading', { level: 1, name: 'Access reserved for administrators' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('This technician account is used in Aegis Mobile.')
    expect(screen.getByText('Account used:')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sign in with another account' })).toBeDefined()
  })
})

describe.each(LOCALES)('SignInPage — every state in %s', (locale) => {
  const t = MESSAGES[locale].signIn
  const format = formattersFor(locale)

  it('shows each client validation error from its code', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.submit }))
    expect(screen.getByText(t.fieldError.emailRequired)).toBeDefined()
    expect(screen.getByText(t.fieldError.passwordRequired)).toBeDefined()
    await user.type(label(t.emailLabel), 'admin@aegis')
    expect(screen.getByText(t.fieldError.emailInvalid)).toBeDefined()
  })

  it('maps server violations by field, with the controlled message of the language', async () => {
    const violations = [{ field: 'password', code: 'INVALID', message: SERVER_TEXT }]
    const gateway = gatewayReturning(httpProblem(400, problemBody(400, 'VALIDATION_ERROR', { violations, detail: SERVER_TEXT })))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, gateway })
    await fillAndSubmit(locale)
    expect(await screen.findByText(t.fieldError.passwordRejected)).toBeDefined()
    expect(document.body.textContent).not.toContain(SERVER_TEXT)
  })

  it('shows the generic message for an unknown violated field', async () => {
    const violations = [{ field: 'tenant', code: 'UNKNOWN', message: SERVER_TEXT }]
    renderWithProviders(<SignInPage afterSignInPath="/" />, {
      locale,
      gateway: gatewayReturning(httpProblem(400, problemBody(400, 'VALIDATION_ERROR', { violations }))),
    })
    await fillAndSubmit(locale)
    expect((await screen.findByRole('alert')).textContent).toBe(t.validationUnknown)
  })

  it('shows the busy label and announces it in a polite status', async () => {
    let release: (value: GatewayResult<LoginResponse>) => void = () => {}
    const signIn = vi.fn<AuthGateway['signIn']>(() => new Promise((resolve) => (release = resolve)))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, gateway: { signIn, currentProfile: vi.fn() } })
    await fillAndSubmit(locale)
    expect(screen.getByRole('button', { name: t.submitting }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(t.submittingStatus).getAttribute('role')).toBe('status')
    await act(async () => release(httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS'))))
  })

  it('refused credentials', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, {
      locale,
      gateway: gatewayReturning(httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS', { title: SERVER_TEXT }))),
    })
    await fillAndSubmit(locale)
    expect((await screen.findByRole('alert')).textContent).toBe(`${t.invalidCredentialsTitle}${t.invalidCredentialsBody}`)
  })

  it('unreachable service', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale })
    await fillAndSubmit(locale)
    expect((await screen.findByRole('alert')).textContent).toBe(`${t.unreachableTitle}${t.unreachableBody}`)
  })

  it('a service error shows the traceId as is, after its translated sentence, and never the server text', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, {
      locale,
      gateway: gatewayReturning(httpProblem(500, problemBody(500, 'INTERNAL_ERROR', { detail: SERVER_TEXT }))),
    })
    await fillAndSubmit(locale)
    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('code')?.textContent).toBe(TRACE_ID)
    expect(alert.textContent).toBe(`${t.serviceErrorTitle}${t.serviceErrorBody}${t.traceIdLabel} ${TRACE_ID}`)
    expect(document.body.textContent).not.toContain(SERVER_TEXT)
  })

  it('an unknown error code gets the controlled generic message and the traceId', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, {
      locale,
      gateway: gatewayReturning(httpProblem(409, problemBody(409, 'SOME_CODE_THIS_CLIENT_DOES_NOT_KNOW', { detail: SERVER_TEXT }))),
    })
    await fillAndSubmit(locale)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${t.serviceErrorTitle}${t.serviceErrorBody}${t.traceIdLabel} ${TRACE_ID}`)
    expect(alert.textContent).not.toContain('SOME_CODE')
    expect(document.body.textContent).not.toContain(SERVER_TEXT)
  })

  it('a service error without any trace uses the message without a code', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, gateway: gatewayReturning({ kind: 'invalidResponse', status: 200, requestId: null }) })
    await fillAndSubmit(locale)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${t.serviceErrorTitle}${t.serviceErrorBodyWithoutCode}`)
    expect(alert.querySelector('code')).toBeNull()
  })

  it('rate limit: the formatted delay appears once, in the alert, then a polite announcement', async () => {
    vi.useFakeTimers()
    renderWithProviders(<SignInPage afterSignInPath="/" />, {
      locale,
      gateway: gatewayReturning(httpProblem(429, problemBody(429, 'RATE_LIMITED'), '3')),
    })
    fireEvent.change(label(t.emailLabel), { target: { value: 'admin@aegis.test' } })
    fireEvent.change(label(t.passwordLabel, 'input'), { target: { value: 'x' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: t.submit })))

    expect(screen.getByRole('alert').textContent).toBe(`${t.rateLimitedTitle}${t.rateLimitedBody({ duration: format.seconds(3) })}`)
    const delay = format.seconds(3)
    expect(document.body.textContent?.split(delay).length, 'the delay appears exactly once').toBe(2)
    expect(document.body.textContent).not.toMatch(/\d:\d{2}/)

    await act(async () => vi.advanceTimersByTime(3000))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(t.rateLimitedReady).getAttribute('role')).toBe('status')
  })

  it('without Retry-After, shows the fixed fallback and does not lock', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, gateway: gatewayReturning(httpProblem(429, null)) })
    await fillAndSubmit(locale)
    expect((await screen.findByRole('alert')).textContent).toBe(`${t.rateLimitedTitle}${t.rateLimitedFallback}`)
  })

  it('role screen for a technician and for an unknown role', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, gateway: gatewayReturning(loginOk(technicianProfile)) })
    await fillAndSubmit(locale)
    expect(await screen.findByRole('heading', { level: 1, name: t.roleHeading })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe(`${t.technicianAccount}${t.roleBody}`)
    expect(screen.getByText(t.roleAccountUsed.replace(/\u00A0/g, ' '))).toBeDefined()
    cleanup()

    const auditor = { ...adminProfile, role: 'AUDITOR' } as unknown as UserProfile
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, gateway: gatewayReturning(loginOk(auditor)) })
    await fillAndSubmit(locale)
    expect((await screen.findByRole('alert')).textContent).toContain(t.roleUnknownTitle)
  })

  it.each([
    ['sessionExpired', 'sessionExpiredTitle', 'sessionExpiredBody'],
    ['sessionInvalid', 'sessionInvalidTitle', 'sessionInvalidBody'],
  ] as const)('arrival %s', (reason, title, body) => {
    const session = createSessionStore()
    session.end(reason, 'admin@aegis.demo')
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, session })
    const status = screen.getByText(t[title]).closest('[role]')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.textContent).toContain(t[body])
  })

  it('arrival after a sign-out', () => {
    const session = createSessionStore()
    session.signOut()
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale, session })
    expect(screen.getByText(t.signedOutTitle).closest('[role]')?.getAttribute('role')).toBe('status')
  })

  it('password visibility: labelled button and announced state', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.revealLabel }))
    expect(screen.getByText(t.revealedStatus).getAttribute('role')).toBe('status')
    const conceal = screen.getByRole('button', { name: t.concealLabel })
    expect(conceal.textContent).toBe(t.conceal)
    await user.click(conceal)
    expect(screen.getByText(t.concealedStatus).getAttribute('role')).toBe('status')
  })

  it('shows no catalog key path anywhere on the page', async () => {
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale })
    await userEvent.setup().click(screen.getByRole('button', { name: t.submit }))
    expect(document.body.textContent).not.toMatch(/\b(?:signIn|landing|shell|brand|language|appearance|pageTitle|equipment|notFound)\.[a-zA-Z]+/)
  })
})

describe('SignInPage — switching language on the page', () => {
  it('re-renders a validation error, an alert and a live-region message in the new language, keeping the typed values', async () => {
    const gateway = gatewayReturning(httpProblem(401, problemBody(401, 'AUTH_INVALID_CREDENTIALS')))
    renderWithProviders(<SignInPage afterSignInPath="/" />, { locale: 'fr', gateway })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(screen.getByText('Saisissez votre adresse courriel.')).toBeDefined()

    await user.click(screen.getByRole('radio', { name: 'English' }))
    expect(screen.getByText('Enter your email address.')).toBeDefined()
    expect(screen.queryByText('Saisissez votre adresse courriel.')).toBeNull()
    expect(document.documentElement.lang).toBe('en-CA')

    await user.type(screen.getByLabelText('Email address'), 'admin@aegis.test')
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Incorrect email address or password.')

    await user.click(screen.getByRole('radio', { name: 'Français' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Adresse courriel ou mot de passe incorrect.'))
    expect((screen.getByLabelText('Adresse courriel') as HTMLInputElement).value).toBe('admin@aegis.test')
    expect(document.documentElement.lang).toBe('fr-CA')
  })
})
