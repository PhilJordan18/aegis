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

  it('lists the six sections in order, every one a link now that each has its page', () => {
    const { sidebar } = renderShell()
    const items = within(sidebar).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      "Vue d'ensemble",
      'Équipements',
      'Réservations et prêts',
      'Casiers',
      'Anomalies',
      'Audit',
    ])
    const links = within(sidebar).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href')).filter((href) => href !== '/')).toEqual(['/vue-d-ensemble', '/apercu/equipements', '/reservations-prets', '/casiers', '/anomalies', '/audit'])
    const current = links.find((link) => link.getAttribute('aria-current') === 'page')
    expect(current?.textContent).toBe('Équipements')
    // No section is « à venir » any more: neither a dimmed item nor its legend remains.
    expect(sidebar.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0)
    expect(sidebar.textContent).not.toContain('Section à venir')
  })

  it('puts the compact top bar in the page banner, so the brand sits inside a landmark', () => {
    renderShell()
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Aegis Manager, accueil' })).toBeDefined()
    expect(within(banner).getByRole('button', { name: 'Ouvrir le menu' })).toBeDefined()
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
