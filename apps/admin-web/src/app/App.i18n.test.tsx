import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile } from '../features/auth/testFixtures'
import { createLocaleController, LOCALE_STORAGE_KEY, type Locale } from '../i18n/locale'
import { MESSAGES } from '../i18n/messages'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'
import { App } from './App'

const KEY_PATH = new RegExp(`\\b(?:${Object.keys(MESSAGES.fr).join('|')})\\.[a-zA-Z]+`)

function browserLanguages(languages: readonly string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '')
}

function signedInSession() {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  return session
}

const gateway: AuthGateway = {
  ...unconfiguredAuthGateway,
  currentProfile: vi.fn(async () => ({ kind: 'ok' as const, value: adminProfile, requestId: null })),
}

beforeEach(() => {
  installMatchMedia(window, false)
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('document language and title', () => {
  it.each([
    ['fr', 'fr-CA', ['Aegis Manager', 'Connexion — Aegis Manager', 'Page introuvable — Aegis Manager']],
    ['en', 'en-CA', ['Aegis Manager', 'Sign in — Aegis Manager', 'Page not found — Aegis Manager']],
  ] as const)('%s: lang is %s and the title follows each route change', (locale, lang, [landing, signIn, notFound]) => {
    const { router } = renderWithProviders(<App />, { locale })
    expect(document.documentElement.lang).toBe(lang)
    expect(document.title).toBe(landing)
    act(() => router.navigate('/connexion'))
    expect(document.title).toBe(signIn)
    expect(document.documentElement.lang).toBe(lang)
    act(() => router.navigate('/nulle-part'))
    expect(document.title).toBe(notFound)
  })

  it('the protected Équipements page has its own title in each language', async () => {
    for (const [locale, title, heading] of [
      ['fr', 'Équipements — Aegis Manager', 'Équipements'],
      ['en', 'Equipment — Aegis Manager', 'Equipment'],
    ] as const) {
      window.history.replaceState(null, '', '/equipements')
      const { unmount } = renderWithProviders(<App />, { locale, gateway, session: signedInSession() })
      expect(document.title).toBe(title)
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeDefined()
      unmount()
    }
  })

  it('switching language updates the title and <html lang> on the current route', async () => {
    const { router } = renderWithProviders(<App />, { locale: 'fr' })
    act(() => router.navigate('/connexion'))
    expect(document.title).toBe('Connexion — Aegis Manager')

    await userEvent.setup().click(screen.getByRole('radio', { name: 'English' }))
    expect(document.title).toBe('Sign in — Aegis Manager')
    expect(document.documentElement.lang).toBe('en-CA')
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeDefined()
  })
})

describe('language resolution through the real controller', () => {
  function renderWithResolution() {
    return renderWithProviders(<App />, { localeController: createLocaleController(window) })
  }

  it('follows the browser: English when the first supported language is English', () => {
    browserLanguages(['de-DE', 'en-US', 'fr-CA'])
    renderWithResolution()
    expect(document.documentElement.lang).toBe('en-CA')
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0)
  })

  it('falls back to French for an unsupported browser language', () => {
    browserLanguages(['es-MX', 'ja'])
    renderWithResolution()
    expect(document.documentElement.lang).toBe('fr-CA')
    expect(screen.getAllByRole('link', { name: 'Se connecter' }).length).toBeGreaterThan(0)
  })

  it('lets the stored choice win over the browser, and keeps it across a reload', async () => {
    browserLanguages(['fr-CA'])
    const first = renderWithResolution()
    expect(document.documentElement.lang).toBe('fr-CA')

    await userEvent.setup().click(screen.getByRole('radio', { name: 'English' }))
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    first.unmount()

    // « Reload »: a fresh controller and a fresh tree, same browser storage.
    renderWithResolution()
    expect(document.documentElement.lang).toBe('en-CA')
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('checked', true)
  })
})

describe('the Français / English switch', () => {
  it('is on the landing page before sign-in, without flags, each option in its own language', async () => {
    renderWithProviders(<App />, { locale: 'fr' })
    const group = screen.getByRole('group', { name: 'Langue' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((option) => option.closest('label')?.textContent)).toEqual(['Français', 'English'])
    expect(options.map((option) => option.closest('label')?.querySelector('[lang]')?.getAttribute('lang'))).toEqual(['fr', 'en'])
    expect(group.querySelector('img, svg')).toBeNull()
    expect(options[0]).toHaveProperty('checked', true)

    const user = userEvent.setup()
    await user.click(within(group).getByRole('radio', { name: 'English' }))
    expect(screen.getByRole('group', { name: 'Language' })).toBeDefined()
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ready. Authorized. Proven.')
  })

  it('is reachable by keyboard and changes with the arrow keys', async () => {
    renderWithProviders(<App />, { locale: 'fr' })
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    const french = screen.getByRole('radio', { name: 'Français' })
    expect(document.activeElement).toBe(french)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('checked', true)
    expect(document.documentElement.lang).toBe('en-CA')
  })

  it('is on the sign-in page, the not-found page and in the signed-in shell', async () => {
    const { router } = renderWithProviders(<App />, { locale: 'en' })
    act(() => router.navigate('/connexion'))
    expect(screen.getByRole('group', { name: 'Language' })).toBeDefined()
    act(() => router.navigate('/nulle-part'))
    expect(screen.getByRole('group', { name: 'Language' })).toBeDefined()
    cleanup()

    window.history.replaceState(null, '', '/equipements')
    renderWithProviders(<App />, { locale: 'fr', gateway, session: signedInSession() })
    const trigger = screen.getAllByRole('button', { name: /Administratrice Test/ })[0] as HTMLElement
    const user = userEvent.setup()
    await user.click(trigger)
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement
    await user.click(within(panel).getByRole('radio', { name: 'English' }))
    expect(document.title).toBe('Equipment — Aegis Manager')
    expect(screen.getAllByRole('navigation', { name: 'Sections' }).length).toBeGreaterThan(0)
    expect(within(panel).getByRole('button', { name: 'Sign out' })).toBeDefined()
    expect(within(panel).getByRole('group', { name: 'Appearance' })).toBeDefined()
  })
})

describe.each<Locale>(['fr', 'en'])('screens in %s', (locale) => {
  const m = MESSAGES[locale]

  it('landing: every text comes from the catalog and no key path is visible', () => {
    renderWithProviders(<App />, { locale })
    expect(document.body.textContent).not.toMatch(KEY_PATH)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(Object.values(m.brand.signature).join(' '))
    expect(screen.getByText(m.brand.tagline)).toBeDefined()
    expect(screen.getByText(m.brand.description)).toBeDefined()
    expect(screen.getByText(m.landing.footerTechnician.replace(/\u00A0/g, ' '))).toBeDefined()
    for (const guarantee of Object.values(m.landing.guarantees)) expect(screen.getByRole('heading', { level: 2, name: guarantee.title })).toBeDefined()
    expect(screen.getByRole('region', { name: m.landing.guaranteesLabel })).toBeDefined()
    expect(screen.getByText(m.landing.noBlockers)).toBeDefined()
    expect(screen.getByText(m.landing.blockers({ count: 1 }).replace(/\u00A0/g, ' '))).toBeDefined()
    expect(screen.getByRole('link', { name: m.brand.homeLabel })).toBeDefined()
  })

  it('landing: the illustrative date is formatted for the language in the Toronto-independent calendar', () => {
    renderWithProviders(<App />, { locale })
    const expected = locale === 'fr' ? '8 sept. 2026' : 'Sep 8, 2026'
    expect(document.body.textContent).toContain(expected)
  })

  it('not found page', () => {
    window.history.replaceState(null, '', '/nulle-part')
    renderWithProviders(<App />, { locale })
    expect(screen.getByRole('heading', { level: 1, name: m.notFound.heading })).toBeDefined()
    expect(screen.getByText(m.notFound.body)).toBeDefined()
    expect(screen.getByRole('link', { name: m.notFound.home })).toBeDefined()
    expect(document.body.textContent).not.toMatch(KEY_PATH)
  })

  it('protected page and shell: navigation, account menu, drawer and skip link are translated', async () => {
    window.history.replaceState(null, '', '/equipements')
    renderWithProviders(<App />, { locale, gateway, session: signedInSession() })
    expect(screen.getByText(m.equipment.pendingTitle)).toBeDefined()
    expect(screen.getByRole('link', { name: m.shell.skipLink }).getAttribute('href')).toBe('#contenu')

    const sidebar = screen.getAllByRole('navigation', { name: m.shell.sectionsLabel })[0] as HTMLElement
    const labels = within(sidebar)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(labels).toEqual([
      `${m.shell.sections.overview}${m.shell.soonSuffix}`,
      m.shell.sections.equipment,
      `${m.shell.sections.reservationsLoans}${m.shell.soonSuffix}`,
      `${m.shell.sections.lockers}${m.shell.soonSuffix}`,
      `${m.shell.sections.anomalies}${m.shell.soonSuffix}`,
      `${m.shell.sections.audit}${m.shell.soonSuffix}`,
    ])
    expect(sidebar.textContent).toContain(m.shell.soonLegend)
    expect(within(sidebar).getByText(m.shell.administratorRole)).toBeDefined()
    expect(screen.getByRole('button', { name: m.shell.openMenu })).toBeDefined()
    // The closed menu and the closed drawer are out of the accessibility tree: read their markup.
    expect(document.querySelectorAll(`[role="group"][aria-label="${m.shell.accountLabel}"]`).length).toBe(2)
    expect([...document.querySelectorAll('.ag-appearance__legend')].map((legend) => legend.textContent)).toEqual([m.appearance.legend, m.appearance.legend])
    expect(document.querySelector('dialog')?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(screen.getAllByRole('radio', { name: m.appearance.system, hidden: true }).length).toBe(2)
    expect(document.body.textContent).not.toMatch(KEY_PATH)
  })

  it('shell avatar initials follow the language casing', async () => {
    window.history.replaceState(null, '', '/equipements')
    renderWithProviders(<App />, { locale, gateway, session: signedInSession() })
    await waitFor(() => expect(document.querySelector('.ag-avatar')?.textContent).toBe('AT'))
  })
})
