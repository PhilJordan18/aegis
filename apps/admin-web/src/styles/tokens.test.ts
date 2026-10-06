import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// tokens.css is transcribed from the design handoff; any drift must be deliberate.
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()

describe('design tokens', () => {
  it('match docs/design/manager-entree/tokens.css', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    const design = readFileSync(resolve(process.cwd(), '../../docs/design/manager-entree/tokens.css'), 'utf8')
    expect(strip(app)).toBe(strip(design))
  })
})
