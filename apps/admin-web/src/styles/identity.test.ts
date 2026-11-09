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

/**
 * The public landing (#153) stages the real locker and names its hub, by Philippe's decision of
 * 2026-11-09 (docs/design/public-landing/handoff.md §2.1). The wording rule skips these files and the
 * `landing` group of the two catalogs; every other rule still applies to them.
 */
const LANDING_FILES = /^(features\/landing\/|pages\/LandingPage\.tsx$|pages\/landing\.css$)/
const CATALOG_FILES = ['i18n/messages/fr.ts', 'i18n/messages/en.ts']
const LANDING_GROUP = /\n {2}landing: \{\n[\s\S]*?\n {2}\},\n/

function relative(file: string): string {
  return file.slice(SRC.length + 1)
}

function withoutLanding(file: string, source: string): string {
  if (LANDING_FILES.test(relative(file))) return ''
  return CATALOG_FILES.includes(relative(file)) ? source.replace(LANDING_GROUP, '\n') : source
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
    ['orbit or lit cell wording', /\b(orbit|lit-cell|is-lit)\b/i],
  ])('has no %s', (_label, pattern) => {
    const hits = files.filter((file) => pattern.test(production(file)))
    expect(hits).toEqual([])
  })

  it('has no hub wording outside the public landing', () => {
    const hits = files.filter((file) => /\bhub\b/i.test(withoutLanding(file, production(file))))
    expect(hits).toEqual([])
  })

  it('exempts from the hub wording rule only the landing files and the landing group of the catalogs', () => {
    const exempt = files.filter((file) => /\bhub\b/i.test(production(file)) && !/\bhub\b/i.test(withoutLanding(file, production(file))))
    for (const file of exempt) expect(LANDING_FILES.test(relative(file)) || CATALOG_FILES.includes(relative(file)), relative(file)).toBe(true)
    for (const catalog of CATALOG_FILES) expect(readFileSync(join(SRC, catalog), 'utf8')).toMatch(LANDING_GROUP)
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
