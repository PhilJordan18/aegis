import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMatchMedia } from '../../test/matchMedia'
import {
  APPEARANCE_STORAGE_KEY,
  createAppearanceController,
  parseAppearancePreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
} from './appearance'

const root = document.documentElement

beforeEach(() => {
  localStorage.clear()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-appearance')
  root.style.colorScheme = ''
})

afterEach(() => {
  localStorage.clear()
})

describe('parseAppearancePreference', () => {
  it.each(['system', 'light', 'dark'] as const)('accepts %s', (value) => {
    expect(parseAppearancePreference(value)).toBe(value)
  })

  it.each([null, undefined, '', 'Dark', 'sombre', 'auto', 1, {}])('ignores %s', (value) => {
    expect(parseAppearancePreference(value)).toBeNull()
  })
})

describe('resolveTheme', () => {
  it('follows the operating system only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('stored preference', () => {
  it('defaults to system when nothing or an invalid value is stored', () => {
    expect(readStoredPreference(window)).toBe('system')
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'purple')
    expect(readStoredPreference(window)).toBe('system')
  })

  it('reads a valid stored value', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark')
    expect(readStoredPreference(window)).toBe('dark')
  })

  it('survives a storage that throws on read and write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(readStoredPreference(window)).toBe('system')
    expect(writeStoredPreference(window, 'dark')).toBe(false)
  })

  it('survives a window whose localStorage getter throws', () => {
    const hostile = new Proxy(window, {
      get(target, property) {
        if (property === 'localStorage') throw new DOMException('blocked', 'SecurityError')
        return Reflect.get(target, property, target)
      },
    })
    expect(readStoredPreference(hostile)).toBe('system')
    expect(writeStoredPreference(hostile, 'light')).toBe(false)
  })
})

describe('createAppearanceController', () => {
  it('applies the resolved theme and colour scheme to <html>', () => {
    installMatchMedia(window, true)
    const controller = createAppearanceController(window)
    expect(controller.getSnapshot()).toEqual({ preference: 'system', theme: 'dark' })
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.appearance).toBe('system')
    expect(root.style.colorScheme).toBe('dark')
    controller.dispose()
  })

  it('follows operating-system changes while the preference is system', () => {
    const media = installMatchMedia(window, false)
    const controller = createAppearanceController(window)
    const listener = vi.fn()
    controller.subscribe(listener)
    media.setDark(true)
    expect(controller.getSnapshot().theme).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    controller.dispose()
    expect(media.listenerCount()).toBe(0)
  })

  it('keeps an explicit preference when the operating system changes', () => {
    const media = installMatchMedia(window, false)
    const controller = createAppearanceController(window)
    controller.setPreference('light')
    media.setDark(true)
    expect(controller.getSnapshot()).toEqual({ preference: 'light', theme: 'light' })
    controller.dispose()
  })

  it('persists only the preference under the appearance key', () => {
    installMatchMedia(window, false)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const controller = createAppearanceController(window)
    controller.setPreference('dark')
    expect(setItem).toHaveBeenCalledExactlyOnceWith(APPEARANCE_STORAGE_KEY, 'dark')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    controller.dispose()
  })

  it('works without matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined })
    const controller = createAppearanceController(window)
    expect(controller.getSnapshot()).toEqual({ preference: 'system', theme: 'light' })
    controller.dispose()
  })
})
