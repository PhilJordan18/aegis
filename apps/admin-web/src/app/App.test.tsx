import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'
import { App } from './App'
import { PAGE_HEADING_ID } from './PageHeading'

beforeEach(() => {
  installMatchMedia(window, false)
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('App routing', () => {
  it('sets the title and does not steal focus on first load of the landing page', () => {
    renderWithProviders(<App />)
    expect(document.title).toBe('Aegis Manager')
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByRole('banner')).toBeDefined()
    expect(screen.getByRole('contentinfo')).toBeDefined()
  })

  it('moves focus to the new page heading after navigation', () => {
    const { router } = renderWithProviders(<App />)
    act(() => router.navigate('/nulle-part'))
    expect(document.title).toBe('Page introuvable — Aegis Manager')
    expect(document.activeElement?.id).toBe(PAGE_HEADING_ID)
  })

  it('lets the sign-in page focus its email field instead of the heading', () => {
    const { router } = renderWithProviders(<App />)
    act(() => router.navigate('/connexion'))
    expect(document.title).toBe('Connexion — Aegis Manager')
    expect(document.activeElement).toBe(screen.getByLabelText('Adresse courriel'))
  })

  it('links the landing call to action to the sign-in page', () => {
    renderWithProviders(<App />)
    const links = screen.getAllByRole('link', { name: /Se connecter/ })
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/connexion', '/connexion'])
  })
})
