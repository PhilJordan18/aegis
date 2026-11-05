import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Measures the contrast of the token pairs that carry text, controls and focus in
 * src/styles/tokens.css, in both appearances (WCAG 2.2: 1.4.3 text 4.5:1, 1.4.11 components
 * 3:1). A palette edit that breaks a pair fails here before it reaches a screen.
 */
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  return new Map([...body.matchAll(/(--ag-[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1] as string, (match[2] as string).trim()]))
}

const LIGHT = block(':root')
const DARK = new Map([...LIGHT, ...block('[data-theme="dark"]')])

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`${hex} is not an opaque #rrggbb colour`)
  const value = parseInt(match[1] as string, 16)
  return 0.2126 * channel(value >> 16) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255)
}

export function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}

type Tokens = Map<string, string>
const pick = (tokens: Tokens, name: string): string => {
  const value = tokens.get(name)
  if (!value) throw new Error(`missing token ${name}`)
  return value
}

const TEXT_ON: readonly (readonly [string, readonly string[]])[] = [
  ['--ag-text', ['--ag-canvas', '--ag-top', '--ag-surface', '--ag-field', '--ag-surface-selected']],
  ['--ag-text-2', ['--ag-canvas', '--ag-top', '--ag-surface', '--ag-field', '--ag-surface-selected', '--ag-surface-sunken']],
  ['--ag-text-3', ['--ag-canvas', '--ag-surface', '--ag-surface-selected']],
  ['--ag-accent-text', ['--ag-canvas', '--ag-surface', '--ag-surface-selected', '--ag-field']],
  ['--ag-text-on-accent', ['--ag-accent', '--ag-accent-hover', '--ag-accent-pressed']],
  ['--ag-text-disabled', ['--ag-disabled-bg']],
  ['--ag-ready-fg', ['--ag-ready-bg']],
  ['--ag-blocked-fg', ['--ag-blocked-bg', '--ag-surface', '--ag-field']],
  ['--ag-unknown-fg', ['--ag-unknown-bg']],
  ['--ag-progress-fg', ['--ag-progress-bg']],
  ['--ag-anomaly-fg', ['--ag-anomaly-bg']],
  ['--ag-info-fg', ['--ag-info-bg']],
  ['--ag-neutral-fg', ['--ag-neutral-bg']],
  ['--ag-text', ['--ag-info-bg', '--ag-blocked-bg', '--ag-unknown-bg']],
  ['--ag-mock-fg', ['--ag-mock-bg']],
]

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
] as const)('design tokens, %s appearance', (_name, tokens) => {
  it.each(TEXT_ON.flatMap(([fg, backgrounds]) => backgrounds.map((bg) => [fg, bg] as const)))('text %s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(pick(tokens, fg), pick(tokens, bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['--ag-control-border', '--ag-surface'],
    ['--ag-control-border', '--ag-field'],
    ['--ag-control-border', '--ag-canvas'],
    ['--ag-focus', '--ag-canvas'],
    ['--ag-focus', '--ag-surface'],
    ['--ag-focus', '--ag-field'],
    ['--ag-focus', '--ag-surface-selected'],
    ['--ag-blocked-fg', '--ag-field'],
    ['--ag-ready-icon', '--ag-ready-bg'],
    ['--ag-blocked-icon', '--ag-blocked-bg'],
    ['--ag-unknown-icon', '--ag-unknown-bg'],
    ['--ag-info-icon', '--ag-info-bg'],
    ['--ag-neutral-icon', '--ag-neutral-bg'],
  ] as const)('component %s on %s reaches 3:1', (fg, bg) => {
    expect(contrast(pick(tokens, fg), pick(tokens, bg))).toBeGreaterThanOrEqual(3)
  })

  it('keeps information distinct from success, warning, error and the accent', () => {
    const info = pick(tokens, '--ag-info-fg')
    for (const other of ['--ag-ready-fg', '--ag-unknown-fg', '--ag-blocked-fg', '--ag-accent-text']) {
      expect(info.toLowerCase(), `info against ${other}`).not.toBe(pick(tokens, other).toLowerCase())
    }
    expect(pick(tokens, '--ag-info-bg').toLowerCase()).not.toBe(pick(tokens, '--ag-progress-bg').toLowerCase())
  })
})

describe('design tokens, identity v3', () => {
  it('defines no glass, atmosphere, cell or gradient token', () => {
    expect(css).not.toMatch(/--ag-(glass|atmos|cell|accent-gradient|blue-|indigo-|night-)/)
    expect(css).not.toMatch(/gradient\(/)
  })

  it('gives the information role a blue hue, neither indigo nor cyan', () => {
    for (const tokens of [LIGHT, DARK]) {
      for (const name of ['--ag-info-fg', '--ag-info-bg', '--ag-info-icon']) {
        const hex = pick(tokens, name).slice(1)
        const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]
        const max = Math.max(r, g, b)
        const delta = max - Math.min(r, g, b)
        const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
        const degrees = hue * 60
        expect(degrees, `${name} hue`).toBeGreaterThan(195)
        expect(degrees, `${name} hue`).toBeLessThan(220)
      }
    }
  })
})
