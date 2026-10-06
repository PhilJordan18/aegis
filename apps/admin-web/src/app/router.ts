import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * Deliberately minimal History API seam for this visual slice. It will be
 * replaced by the router chosen at API integration time; keep its surface
 * small (location, navigate, focus-after-navigation) so the swap stays local.
 */
export interface RouterLocation {
  readonly pathname: string
  readonly search: string
}

export interface Router {
  getSnapshot(): RouterLocation
  subscribe(listener: () => void): () => void
  navigate(to: string, options?: { replace?: boolean }): void
  /** True once after a navigation that changed the path; the page heading takes focus. */
  consumeFocusRequest(): boolean
  dispose(): void
}

export function createHistoryRouter(win: Window = window): Router {
  const listeners = new Set<() => void>()
  let focusRequested = false
  let snapshot = read()

  function read(): RouterLocation {
    return { pathname: win.location.pathname, search: win.location.search }
  }

  function refresh() {
    const next = read()
    if (next.pathname === snapshot.pathname && next.search === snapshot.search) return
    if (next.pathname !== snapshot.pathname) focusRequested = true
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  win.addEventListener('popstate', refresh)

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    navigate(to, options) {
      const url = new URL(to, win.location.href)
      if (url.origin !== win.location.origin) throw new Error('Cross-origin navigation is not handled by the router')
      const target = `${url.pathname}${url.search}${url.hash}`
      if (options?.replace) win.history.replaceState(null, '', target)
      else win.history.pushState(null, '', target)
      refresh()
    },
    consumeFocusRequest() {
      const requested = focusRequested
      focusRequested = false
      return requested
    },
    dispose() {
      win.removeEventListener('popstate', refresh)
      listeners.clear()
    },
  }
}

export const RouterContext = createContext<Router | null>(null)

export function useRouter(): Router {
  const router = useContext(RouterContext)
  if (!router) throw new Error('useRouter requires a RouterContext provider')
  return router
}

export function useLocation(): RouterLocation {
  const router = useRouter()
  return useSyncExternalStore(router.subscribe, router.getSnapshot)
}
