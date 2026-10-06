import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { installMatchMedia } from '../../test/matchMedia'
import { APPEARANCE_STORAGE_KEY, applyAppearance, parseAppearancePreference, resolveTheme } from './appearance'

// The inline script in index.html runs before first paint; it must agree with appearance.ts.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const bootScript = /<script id="appearance-boot">([\s\S]*?)<\/script>/.exec(html)?.[1]

const root = document.documentElement

function snapshotOfRoot() {
  return { theme: root.dataset.theme, appearance: root.dataset.appearance, colorScheme: root.style.colorScheme }
}

beforeEach(() => {
  localStorage.clear()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-appearance')
  root.style.colorScheme = ''
})

describe('index.html appearance boot script', () => {
  it('exists and uses the same storage key', () => {
    expect(bootScript).toBeDefined()
    expect(bootScript).toContain(`'${APPEARANCE_STORAGE_KEY}'`)
  })

  const stored = [null, 'system', 'light', 'dark', 'invalid'] as const
  const osDark = [false, true] as const
  for (const value of stored) {
    for (const dark of osDark) {
      it(`matches appearance.ts for stored=${value} and osDark=${dark}`, () => {
        installMatchMedia(window, dark)
        if (value !== null) localStorage.setItem(APPEARANCE_STORAGE_KEY, value)
        new Function(bootScript ?? '')()
        const fromBoot = snapshotOfRoot()

        const preference = parseAppearancePreference(value) ?? 'system'
        applyAppearance(root, preference, resolveTheme(preference, dark))
        expect(fromBoot).toEqual(snapshotOfRoot())
      })
    }
  }
})
