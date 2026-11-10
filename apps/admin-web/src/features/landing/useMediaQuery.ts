import { useCallback, useSyncExternalStore } from 'react'

/** A media query as React state; false where `matchMedia` is missing (tests, very old engines). */
export function useMediaQuery(query: string): boolean {
  // Stable per query, so React does not resubscribe on every render.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}
