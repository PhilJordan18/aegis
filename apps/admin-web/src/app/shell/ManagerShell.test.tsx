import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminProfile } from '../../features/auth/testFixtures'
import { installMatchMedia } from '../../test/matchMedia'
import { renderWithProviders } from '../../test/renderApp'
import { ManagerShell } from './ManagerShell'

function renderShell(onSignOut = vi.fn()) {
  const result = renderWithProviders(
    <ManagerShell currentPath="/apercu/equipements" profile={adminProfile} onSignOut={onSignOut}>
      <main id="contenu" tabIndex={-1}>
        <h1>Équipements</h1>
      </main>
    </ManagerShell>,
  )
  const sidebar = screen.getAllByRole('navigation', { name: 'Sections' })[0]
  if (!sidebar) throw new Error('missing sidebar')
  return { ...result, sidebar, onSignOut }
}

beforeEach(() => {
  installMatchMedia(window, false)
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ManagerShell', () => {
  it('starts with the skip link to the main content', async () => {
    renderShell()
    await userEvent.setup().tab()
    const skip = screen.getByRole('link', { name: 'Aller au contenu principal' })
    expect(document.activeElement).toBe(skip)
    expect(skip.getAttribute('href')).toBe('#contenu')
  })

  it('lists the six sections in order, with only the built one focusable', () => {
    const { sidebar } = renderShell()
    const items = within(sidebar).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      "Vue d'ensemble, à venir",
      'Équipements',
      'Réservations et prêts, à venir',
      'Casiers, à venir',
      'Anomalies, à venir',
      'Audit, à venir',
    ])
    const links = within(sidebar).getAllByRole('link')
    const current = links.find((link) => link.getAttribute('aria-current') === 'page')
    expect(current?.textContent).toBe('Équipements')
    const soon = sidebar.querySelectorAll('[aria-disabled="true"]')
    expect(soon).toHaveLength(5)
    soon.forEach((element) => expect(element.matches('a, button, [tabindex]')).toBe(false))
    expect(sidebar.textContent).toContain('Section à venir')
  })

  it('opens the account disclosure, applies the appearance at once, and closes with Escape', async () => {
    renderShell()
    const user = userEvent.setup()
    const trigger = screen.getAllByRole('button', { name: /Administratrice Test/ })[0]
    if (!trigger) throw new Error('missing account button')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
    expect(panel?.hidden).toBe(false)
    expect(panel?.textContent).toContain(adminProfile.email)

    await user.click(within(panel as HTMLElement).getByRole('radio', { name: 'Sombre' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('aegis.manager.appearance')).toBe('dark')

    await user.keyboard('{Escape}')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the account disclosure on an outside click and signs out from it', async () => {
    const { onSignOut } = renderShell()
    const user = userEvent.setup()
    const trigger = screen.getAllByRole('button', { name: /Administratrice Test/ })[0] as HTMLElement
    await user.click(trigger)
    await user.click(screen.getByRole('heading', { name: 'Équipements' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.click(trigger)
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement
    await user.click(within(panel).getByRole('button', { name: 'Se déconnecter' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
