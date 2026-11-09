import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/messages/en'
import { fr } from '../i18n/messages/fr'
import { renderWithProviders } from '../test/renderApp'
import { LandingPage } from './LandingPage'

/** `matchMedia` answering true for the listed queries only, so each layout branch can be chosen. */
function mediaMatching(...queries: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: queries.includes(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }),
  })
}

type Observed = { callback: IntersectionObserverCallback; targets: Element[] }

function installIntersectionObserver() {
  const observers: Observed[] = []
  class FakeObserver {
    readonly record: Observed
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, targets: [] }
      observers.push(this.record)
    }
    observe(target: Element) {
      this.record.targets.push(target)
    }
    disconnect() {
      this.record.targets = []
    }
    unobserve() {}
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  return {
    enter(target: Element) {
      for (const { callback, targets } of observers) {
        if (!targets.includes(target)) continue
        callback([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
      }
    },
  }
}

beforeEach(() => {
  mediaMatching()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LandingPage', () => {
  it('has one h1, the seven sections and a sign-in link to /connexion in French', () => {
    renderWithProviders(<LandingPage />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    for (const id of ['produit', 'readiness', 'parcours', 'systeme', 'garanties', 'studio']) {
      expect(document.getElementById(id), id).not.toBeNull()
    }
    expect(screen.getByRole('heading', { level: 2, name: fr.landing.journey.title })).toBeDefined()
    const signIn = screen.getAllByRole('link', { name: new RegExp(fr.landing.signIn) })
    expect(signIn.map((link) => link.getAttribute('href'))).toEqual(['/connexion', '/connexion'])
  })

  it('renders the same structure in English', () => {
    renderWithProviders(<LandingPage />, { locale: 'en' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2, name: en.landing.journey.title })).toBeDefined()
    expect(screen.getByText(en.landing.diagnostic.secondFacts)).toBeDefined()
    expect(screen.queryByText(fr.landing.journey.title)).toBeNull()
  })

  it('lists six steps, only the first one available, each with its own still vignette by default', () => {
    renderWithProviders(<LandingPage />)
    const steps = within(document.getElementById('parcours') as HTMLElement).getAllByRole('listitem')
    expect(steps).toHaveLength(6)
    expect(steps.filter((step) => within(step).queryByText(fr.landing.journey.tagLive))).toHaveLength(1)
    expect(within(steps[0] as HTMLElement).getByText(fr.landing.journey.tagLive)).toBeDefined()
    for (const step of steps) {
      expect(within(step).getByRole('img')).toBeDefined()
      expect(step.getAttribute('aria-current')).toBeNull()
    }
  })

  it('follows the step being read from 1024 px, and announces it once in the rail', () => {
    mediaMatching('(min-width: 1024px)')
    const io = installIntersectionObserver()
    renderWithProviders(<LandingPage />)
    const steps = within(document.getElementById('parcours') as HTMLElement).getAllByRole('listitem')
    expect(steps[0]?.getAttribute('aria-current')).toBe('step')
    act(() => io.enter(steps[3] as HTMLElement))
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, null, null, 'step', null, null])
    const caption = fr.landing.journey.stepCaption({ number: '04', state: fr.landing.journey.steps.open.state })
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(caption)
  })

  it('keeps still vignettes with reduced motion even when wide', () => {
    mediaMatching('(min-width: 1024px)', '(prefers-reduced-motion: reduce)')
    renderWithProviders(<LandingPage />)
    const steps = within(document.getElementById('parcours') as HTMLElement).getAllByRole('listitem')
    for (const step of steps) expect(step.getAttribute('aria-current')).toBeNull()
    expect(document.querySelector('[aria-live="polite"]')).toBeNull()
  })

  it('replaces a render that fails to load with the silhouette and a calm description', () => {
    renderWithProviders(<LandingPage />)
    const hero = screen.getByRole('img', { name: fr.landing.heroAlt })
    const image = hero.querySelector('img') as HTMLImageElement
    fireEvent.error(image)
    expect(hero.getAttribute('aria-label')).toBe(fr.landing.deviceFallback)
    expect(hero.className).toContain('lp-device--failed')
  })

  it('opens the section sheet below 1024 px and closes it with Escape, returning focus', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LandingPage />)
    const toggle = screen.getByRole('button', { name: fr.landing.sectionsMenu })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })
})
