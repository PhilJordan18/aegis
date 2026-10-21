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
    const hits = files.filter((file) => pattern.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    expect(hits).toEqual([])
  })

  it('allows the one localized halo, a radial gradient, only on the promise surfaces', () => {
    const radial = files.filter((file) => /radial-gradient/.test(readFileSync(file, 'utf8')))
    expect(radial.map((file) => file.slice(SRC.length + 1)).sort()).toEqual(['features/auth/sign-in.css', 'pages/landing.css'])
  })
})
