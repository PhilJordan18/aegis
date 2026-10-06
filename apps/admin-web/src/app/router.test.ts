import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHistoryRouter } from './router'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('createHistoryRouter', () => {
  it('pushes a same-origin entry and notifies subscribers', () => {
    const router = createHistoryRouter(window)
    const listener = vi.fn()
    router.subscribe(listener)
    router.navigate('/connexion?apercu=validation')
    expect(window.location.pathname).toBe('/connexion')
    expect(router.getSnapshot()).toEqual({ pathname: '/connexion', search: '?apercu=validation' })
    expect(listener).toHaveBeenCalledTimes(1)
    router.dispose()
  })

  it('requests heading focus only when the path changes', () => {
    const router = createHistoryRouter(window)
    router.navigate('/connexion')
    expect(router.consumeFocusRequest()).toBe(true)
    expect(router.consumeFocusRequest()).toBe(false)
    router.navigate('/connexion?apercu=envoi', { replace: true })
    expect(router.consumeFocusRequest()).toBe(false)
    router.dispose()
  })

  it('follows browser back and forward', () => {
    const router = createHistoryRouter(window)
    router.navigate('/connexion')
    window.history.replaceState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(router.getSnapshot().pathname).toBe('/')
    router.dispose()
  })

  it('refuses cross-origin navigation', () => {
    const router = createHistoryRouter(window)
    expect(() => router.navigate('https://example.com/')).toThrow()
    router.dispose()
  })
})
