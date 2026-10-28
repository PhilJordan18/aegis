import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Identity v3 (issue #79): the entry screens and the shell carry no hub, cells, lit cell, orbit,
 * glass or blue-to-indigo gradient. Production sources only; the design-review preview is
 * restyled but never part of this contract.
 */
const SRC = resolve(process.cwd(), 'src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'preview' || name === 'assets' ? [] : sources(path)
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/**
 * The one functional gradient allowed in production: the scroll shadow of the Équipements dossier
 * (review R3). Neutral surface or shadow tint to transparent, on `.ag-dossier__scroll` only. Matched
 * layer by layer and removed before the gradient rule runs, so any other gradient, in that file or
 * elsewhere, still fails.
 */
const SCROLL_SHADOW_FILE = 'features/catalog/equipment.css'
const SCROLL_SHADOW_LAYERS = [
  'linear-gradient(var(--ag-surface) 30%, transparent) center top / 100% 28px no-repeat local',
  'linear-gradient(transparent, var(--ag-surface) 70%) center bottom / 100% 28px no-repeat local',
  'linear-gradient(rgba(var(--ag-shadow-tint), 0.16), transparent) center top / 100% 12px no-repeat scroll',
  'linear-gradient(transparent, rgba(var(--ag-shadow-tint), 0.16)) center bottom / 100% 12px no-repeat scroll',
]

function withoutScrollShadow(file: string, css: string): string {
  if (file.slice(SRC.length + 1) !== SCROLL_SHADOW_FILE) return css
  return css.replace(/\.ag-dossier__scroll\s*\{[^}]*\}/g, (rule) => SCROLL_SHADOW_LAYERS.reduce((text, layer) => text.replace(layer, ''), rule))
}

function production(file: string): string {
  return withoutScrollShadow(file, readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
}

describe('identity v3 in production sources', () => {
  const files = sources(SRC)

  it('finds the sources it scans', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it.each([
    ['backdrop blur (glass)', /backdrop-filter/],
    ['glass, atmosphere or cell class or token', /ag-(glass|atmos|cells?|decor)\b|--ag-(glass|atmos|cell)/],
    ['indigo', /indigo/i],
    ['the former blue and indigo ramp values', /#(4B3BD9|6153F5|3B2DB0|1F4FE6|3366FF|8177FF|A9A2FF)/i],
    ['a gradient on a surface or a button', /(linear|conic)-gradient/],
    ['hub, orbit or lit cell wording', /\b(orbit|hub|lit-cell|is-lit)\b/i],
  ])('has no %s', (_label, pattern) => {
    const hits = files.filter((file) => pattern.test(production(file)))
    expect(hits).toEqual([])
  })

  it('allows exactly one gradient rule besides the halo: the four-layer scroll shadow of the dossier', () => {
    const css = readFileSync(join(SRC, SCROLL_SHADOW_FILE), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = css.match(/\.ag-dossier__scroll\s*\{[^}]*\}/)?.[0] ?? ''
    for (const layer of SCROLL_SHADOW_LAYERS) expect(rule, layer).toContain(layer)
    expect(rule.match(/linear-gradient/g)).toHaveLength(4)
    const linear = files.filter((file) => /linear-gradient/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    expect(linear.map((file) => file.slice(SRC.length + 1))).toEqual([SCROLL_SHADOW_FILE])
  })

  it('allows the one localized halo, a radial gradient, only on the promise surfaces', () => {
    const radial = files.filter((file) => /radial-gradient/.test(readFileSync(file, 'utf8')))
    expect(radial.map((file) => file.slice(SRC.length + 1)).sort()).toEqual(['features/auth/sign-in.css', 'pages/landing.css'])
  })
})
