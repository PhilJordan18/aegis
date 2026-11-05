import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLocaleController,
  DEFAULT_LOCALE,
  FORMAT_LOCALE,
  LOCALE_STORAGE_KEY,
  localeFromLanguageTag,
  parseLocale,
  readStoredLocale,
  resolveBrowserLocale,
  resolveInitialLocale,
  writeStoredLocale,
} from './locale'

function browserLanguages(languages: readonly string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('lang')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('language tags', () => {
  it.each([
    ['fr', 'fr'],
    ['fr-CA', 'fr'],
    ['fr-FR', 'fr'],
    ['fr_BE', 'fr'],
    ['FR', 'fr'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
  ])('%s is %s', (tag, expected) => {
    expect(localeFromLanguageTag(tag)).toBe(expected)
  })

  it.each(['es', 'es-MX', 'de-DE', 'fil', 'ensemble', 'frr-DE', '', '-'])('%s is not supported', (tag) => {
    expect(localeFromLanguageTag(tag)).toBeNull()
  })

  it('parses only the two stored values', () => {
    expect(parseLocale('fr')).toBe('fr')
    expect(parseLocale('en')).toBe('en')
    expect(parseLocale('fr-CA')).toBeNull()
    expect(parseLocale(null)).toBeNull()
    expect(parseLocale(42)).toBeNull()
  })
})

describe('browser preference', () => {
  it('takes the first supported language, in the browser order', () => {
    expect(resolveBrowserLocale(['en-US', 'fr-CA'])).toBe('en')
    expect(resolveBrowserLocale(['fr-FR', 'en'])).toBe('fr')
  })

  it('skips unsupported languages before the first supported one', () => {
    expect(resolveBrowserLocale(['de-DE', 'es', 'en-GB', 'fr'])).toBe('en')
  })

  it('falls back to French when nothing is supported or nothing is sent', () => {
    expect(resolveBrowserLocale(['de', 'es-MX', 'ja'])).toBe(DEFAULT_LOCALE)
    expect(resolveBrowserLocale([])).toBe('fr')
    expect(DEFAULT_LOCALE).toBe('fr')
  })

  it('formats fr-FR and en-US users as fr-CA and en-CA', () => {
    expect(FORMAT_LOCALE[resolveBrowserLocale(['fr-FR'])]).toBe('fr-CA')
    expect(FORMAT_LOCALE[resolveBrowserLocale(['en-US'])]).toBe('en-CA')
  })
})

describe('resolution order', () => {
  it('uses the browser languages when nothing is stored', () => {
    browserLanguages(['en-US', 'en'])
    expect(resolveInitialLocale(window)).toBe('en')
    browserLanguages(['fr-CA'])
    expect(resolveInitialLocale(window)).toBe('fr')
  })

  it('falls back to French for an unsupported browser language', () => {
    browserLanguages(['es-ES', 'de'])
    expect(resolveInitialLocale(window)).toBe('fr')
  })

  it('lets a stored explicit choice win over the browser', () => {
    browserLanguages(['en-US'])
    writeStoredLocale(window, 'fr')
    expect(resolveInitialLocale(window)).toBe('fr')
    browserLanguages(['fr-CA'])
    writeStoredLocale(window, 'en')
    expect(resolveInitialLocale(window)).toBe('en')
  })

  it('ignores an invalid stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon')
    browserLanguages(['en-CA'])
    expect(readStoredLocale(window)).toBeNull()
    expect(resolveInitialLocale(window)).toBe('en')
  })

  it('uses navigator.language when navigator.languages is empty', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue([])
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US')
    expect(resolveInitialLocale(window)).toBe('en')
  })
})

describe('storage failures', () => {
  it('does not throw when storage refuses to be read or written, and still applies the choice', () => {
    browserLanguages(['en-US'])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const controller = createLocaleController(window)
    expect(controller.getSnapshot()).toBe('en')
    expect(writeStoredLocale(window, 'fr')).toBe(false)
    controller.setLocale('fr')
    expect(controller.getSnapshot()).toBe('fr')
    expect(document.documentElement.lang).toBe('fr-CA')
  })

  it('treats an inaccessible localStorage as empty', () => {
    browserLanguages(['fr'])
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('sandboxed')
    })
    expect(readStoredLocale(window)).toBeNull()
    expect(writeStoredLocale(window, 'en')).toBe(false)
    expect(resolveInitialLocale(window)).toBe('fr')
  })
})

describe('createLocaleController', () => {
  it('sets <html lang> from the resolved language on creation', () => {
    browserLanguages(['en-GB'])
    createLocaleController(window)
    expect(document.documentElement.lang).toBe('en-CA')
    browserLanguages(['fr-FR'])
    createLocaleController(window)
    expect(document.documentElement.lang).toBe('fr-CA')
  })

  it('lets a pinned initial language skip the resolution', () => {
    browserLanguages(['en-US'])
    expect(createLocaleController(window, { initial: 'fr' }).getSnapshot()).toBe('fr')
    expect(document.documentElement.lang).toBe('fr-CA')
  })

  it('applies a choice at once: notifies, updates <html lang>, stores it', () => {
    browserLanguages(['fr-CA'])
    const controller = createLocaleController(window)
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.setLocale('en')
    expect(controller.getSnapshot()).toBe('en')
    expect(document.documentElement.lang).toBe('en-CA')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    expect(listener).toHaveBeenCalledTimes(1)

    controller.setLocale('en')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('persists across a reload: a new controller reads the stored choice, not the browser', () => {
    browserLanguages(['fr-CA'])
    createLocaleController(window).setLocale('en')

    const afterReload = createLocaleController(window)
    expect(afterReload.getSnapshot()).toBe('en')
    expect(document.documentElement.lang).toBe('en-CA')
  })

  it('writes nothing to storage until the user chooses', () => {
    browserLanguages(['en-US'])
    createLocaleController(window)
    expect(localStorage.length).toBe(0)
  })

  it('stops notifying an unsubscribed listener', () => {
    const controller = createLocaleController(window, { initial: 'fr' })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    unsubscribe()
    controller.setLocale('en')
    expect(listener).not.toHaveBeenCalled()
  })
})
