/** Minimal controllable `matchMedia` for jsdom, which does not implement it. */
export function installMatchMedia(win: Window, initiallyDark: boolean) {
  let dark = initiallyDark
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const list = {
    get matches() {
      return dark
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList
  Object.defineProperty(win, 'matchMedia', { configurable: true, writable: true, value: () => list })
  return {
    setDark(next: boolean) {
      dark = next
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent))
    },
    listenerCount: () => listeners.size,
  }
}
