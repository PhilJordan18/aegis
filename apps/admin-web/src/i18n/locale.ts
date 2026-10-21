/**
 * Interface language (issue #78, docs/localisation/convention.md). Two languages
 * are supported; French is the reference and the fallback. The language only
 * changes presentation: it never changes a contract code, a business rule or
 * the locker time zone.
 *
 * Resolution order: the explicit choice kept in the browser, else the first
 * browser-preferred language that is French or English, else French. Like the
 * appearance, the choice is a UI preference kept in localStorage, never a token.
 */

export type Locale = 'fr' | 'en'

export const LOCALES: readonly Locale[] = ['fr', 'en']
export const DEFAULT_LOCALE: Locale = 'fr'
export const LOCALE_STORAGE_KEY = 'aegis.manager.language'

/** Formatting locale (`Intl`), also the value of `<html lang>`. `fr-FR` or `en-US` users still get fr-CA or en-CA. */
export const FORMAT_LOCALE: Readonly<Record<Locale, string>> = { fr: 'fr-CA', en: 'en-CA' }

/** Each language is named in itself, in both languages: a visitor must recognise their own whatever the page shows. */
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { fr: 'Français', en: 'English' }

export function parseLocale(value: unknown): Locale | null {
  return value === 'fr' || value === 'en' ? value : null
}

/** `fr`, `fr-FR`, `fr_CA` and `en-US` match; `fil`, `ensemble` and `es` do not (primary subtag only). */
export function localeFromLanguageTag(tag: string): Locale | null {
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase()
  return parseLocale(primary)
}

export function resolveBrowserLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const locale = localeFromLanguageTag(tag)
    if (locale) return locale
  }
  return DEFAULT_LOCALE
}

/** Accessing `window.localStorage` itself can throw (blocked site data, sandboxed frame). */
function storageOf(win: Window): Storage | null {
  try {
    return win.localStorage
  } catch {
    return null
  }
}

export function readStoredLocale(win: Window): Locale | null {
  try {
    return parseLocale(storageOf(win)?.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return null
  }
}

/** Returns false when the browser refuses to persist; the choice still applies for this page. */
export function writeStoredLocale(win: Window, locale: Locale): boolean {
  try {
    const storage = storageOf(win)
    if (!storage) return false
    storage.setItem(LOCALE_STORAGE_KEY, locale)
    return true
  } catch {
    return false
  }
}

function browserLanguages(win: Window): readonly string[] {
  try {
    const { languages, language } = win.navigator
    if (languages && languages.length > 0) return languages
    return language ? [language] : []
  } catch {
    return []
  }
}

export function resolveInitialLocale(win: Window): Locale {
  return readStoredLocale(win) ?? resolveBrowserLocale(browserLanguages(win))
}

export interface LocaleController {
  getSnapshot(): Locale
  subscribe(listener: () => void): () => void
  /** Applies the language at once and keeps it in the browser. */
  setLocale(locale: Locale): void
}

/**
 * Keeps `<html lang>` in sync with the language. `initial` is for tests and
 * previews that must not depend on the browser's preferences.
 */
export function createLocaleController(win: Window = window, options: { readonly initial?: Locale } = {}): LocaleController {
  const listeners = new Set<() => void>()
  const root = win.document.documentElement
  let current: Locale = options.initial ?? resolveInitialLocale(win)
  root.lang = FORMAT_LOCALE[current]

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setLocale(locale) {
      writeStoredLocale(win, locale)
      if (locale === current) return
      current = locale
      root.lang = FORMAT_LOCALE[locale]
      listeners.forEach((listener) => listener())
    },
  }
}
