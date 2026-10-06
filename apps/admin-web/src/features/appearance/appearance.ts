/**
 * Appearance preference (Système / Clair / Sombre), design decision U7 and
 * sections.md §5.7. The preference is local to the browser. It is the only
 * value this application writes to localStorage and it is never a token.
 */

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const APPEARANCE_STORAGE_KEY = 'aegis.manager.appearance'
export const APPEARANCE_PREFERENCES: readonly AppearancePreference[] = ['system', 'light', 'dark']
export const DEFAULT_APPEARANCE: AppearancePreference = 'system'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function parseAppearancePreference(value: unknown): AppearancePreference | null {
  return value === 'system' || value === 'light' || value === 'dark' ? value : null
}

export function resolveTheme(preference: AppearancePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

/** Accessing `window.localStorage` itself can throw (blocked site data, sandboxed frame). */
function storageOf(win: Window): Storage | null {
  try {
    return win.localStorage
  } catch {
    return null
  }
}

export function readStoredPreference(win: Window): AppearancePreference {
  try {
    return parseAppearancePreference(storageOf(win)?.getItem(APPEARANCE_STORAGE_KEY)) ?? DEFAULT_APPEARANCE
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** Returns false when the browser refuses to persist; the preference still applies for this page. */
export function writeStoredPreference(win: Window, preference: AppearancePreference): boolean {
  try {
    const storage = storageOf(win)
    if (!storage) return false
    storage.setItem(APPEARANCE_STORAGE_KEY, preference)
    return true
  } catch {
    return false
  }
}

function prefersDarkScheme(win: Window): boolean {
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

export function applyAppearance(root: HTMLElement, preference: AppearancePreference, theme: ResolvedTheme): void {
  root.setAttribute('data-appearance', preference)
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
}

export interface AppearanceSnapshot {
  readonly preference: AppearancePreference
  readonly theme: ResolvedTheme
}

export interface AppearanceController {
  getSnapshot(): AppearanceSnapshot
  subscribe(listener: () => void): () => void
  setPreference(preference: AppearancePreference): void
  dispose(): void
}

/**
 * Keeps `<html>` in sync with the preference and, for `system`, with the
 * operating-system colour scheme. The boot script in index.html has already
 * applied the same result before first paint.
 */
export function createAppearanceController(win: Window = window): AppearanceController {
  const listeners = new Set<() => void>()
  const root = win.document.documentElement
  let snapshot: AppearanceSnapshot = compute(readStoredPreference(win))

  function compute(preference: AppearancePreference): AppearanceSnapshot {
    return { preference, theme: resolveTheme(preference, prefersDarkScheme(win)) }
  }

  function update(next: AppearanceSnapshot) {
    applyAppearance(root, next.preference, next.theme)
    if (next.preference === snapshot.preference && next.theme === snapshot.theme) return
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const onSchemeChange = () => update(compute(snapshot.preference))
  let media: MediaQueryList | null = null
  try {
    media = typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : null
    media?.addEventListener('change', onSchemeChange)
  } catch {
    media = null
  }

  applyAppearance(root, snapshot.preference, snapshot.theme)

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setPreference(preference) {
      writeStoredPreference(win, preference)
      update(compute(preference))
    },
    dispose() {
      media?.removeEventListener('change', onSchemeChange)
      listeners.clear()
    },
  }
}
