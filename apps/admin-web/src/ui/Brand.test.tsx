import { cleanup, screen, within } from '@testing-library/react'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'
import { Brand } from './Brand'

beforeEach(() => installMatchMedia(window, false))
afterEach(cleanup)

const BRAND_DIR = resolve(process.cwd(), 'src/assets/brand')
const brandCss = readFileSync(resolve(process.cwd(), 'src/ui/brand.css'), 'utf8')

describe('Brand', () => {
  it.each([
    ['fr', 'Aegis Manager, accueil'],
    ['en', 'Aegis Manager, home'],
  ] as const)('is one link to the landing page named in %s, showing « aegis » and « Manager » as text', (locale, name) => {
    renderWithProviders(<Brand />, { locale })
    const link = screen.getByRole('link', { name })
    expect(link.getAttribute('href')).toBe('/')
    expect(within(link).getByText('aegis')).toBeDefined()
    expect(within(link).getByText('Manager')).toBeDefined()
  })

  it('draws the symbol from the two replaceable asset files and copies no geometry', () => {
    const { container } = renderWithProviders(<Brand />)
    const images = [...container.querySelectorAll('img')]
    expect(images.map((image) => image.className)).toEqual(['ag-brand__img ag-brand__img--light', 'ag-brand__img ag-brand__img--dark'])
    for (const image of images) {
      expect(image.getAttribute('alt')).toBe('')
      expect(image.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(images[0]?.getAttribute('src')).not.toBe(images[1]?.getAttribute('src'))
    expect(container.querySelector('svg, path')).toBeNull()

    // The swap point: exactly the two files, square, with no text (the symbol alone has no font dependency).
    expect(readdirSync(BRAND_DIR).filter((file) => file.endsWith('.svg')).sort()).toEqual(['aegis-core-mark-dark.svg', 'aegis-core-mark.svg'])
    for (const file of ['aegis-core-mark.svg', 'aegis-core-mark-dark.svg']) {
      const svg = readFileSync(resolve(BRAND_DIR, file), 'utf8')
      expect(svg, file).toMatch(/viewBox="0 0 64 64"/)
      expect(svg, file).not.toMatch(/<text/)
    }
  })

  it('shows one symbol per appearance, from data-theme', () => {
    expect(brandCss).toMatch(/\[data-theme='dark'\] \.ag-brand__img--light/)
    expect(brandCss).toMatch(/:not\(\[data-theme='dark'\]\) \.ag-brand__img--dark/)
  })

  it('never hides « Manager » at any width: it moves to a second line on small screens instead', () => {
    const rules = [...brandCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    for (const [, selector, body] of rules) {
      if ((selector as string).includes('.ag-brand__app') || (selector as string).includes('.ag-brand__text')) {
        expect(body, selector).not.toMatch(/display:\s*none|visibility:\s*hidden/)
      }
    }
    expect(brandCss).toMatch(/max-width: 479px[\s\S]*flex-direction: column/)
  })
})
