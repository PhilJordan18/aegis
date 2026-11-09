/*
 * Renders the high-fidelity mockup of direction A (../mockups/a-mise-en-scene.html)
 * with the Playwright Chromium of apps/admin-web (run `npm ci --ignore-scripts` there):
 *   node docs/design/public-landing/verify/render-mockups.mjs [--only <name>]
 * Writes PNGs into ../mockups/renders/ and reports horizontal overflow and axe
 * violations per variant. No network: fonts and images are local files.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '../../../../apps/admin-web/package.json'))
const { chromium } = require('@playwright/test')
const AxeBuilder = require('@axe-core/playwright').default

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const page = resolve(here, '../mockups/a-mise-en-scene.html')
const out = resolve(here, '../mockups/renders')
mkdirSync(out, { recursive: true })

const V = (name, q, view, extra = {}) => ({ name, q, view, ...extra })
const VARIANTS = [
  // nominal matrix, French
  V('a-dark-fr-1440', 'theme=dark&lang=fr', { w: 1440, h: 900 }),
  V('a-light-fr-1440', 'theme=light&lang=fr', { w: 1440, h: 900 }),
  V('a-dark-fr-768', 'theme=dark&lang=fr', { w: 768, h: 1024 }),
  V('a-light-fr-768', 'theme=light&lang=fr', { w: 768, h: 1024 }),
  V('a-dark-fr-390', 'theme=dark&lang=fr', { w: 390, h: 844 }),
  V('a-light-fr-390', 'theme=light&lang=fr', { w: 390, h: 844 }),
  V('a-dark-fr-320', 'theme=dark&lang=fr', { w: 320, h: 568 }),
  V('a-light-fr-320', 'theme=light&lang=fr', { w: 320, h: 568 }),
  // English
  V('a-dark-en-1440', 'theme=dark&lang=en', { w: 1440, h: 900 }),
  V('a-light-en-390', 'theme=light&lang=en', { w: 390, h: 844 }),
  // states
  V('a-dark-fr-1440-reduced', 'theme=dark&lang=fr', { w: 1440, h: 900 }, { reduced: true }),
  V('a-light-fr-1440-no-device', 'theme=light&lang=fr&device=none', { w: 1440, h: 900 }),
  V('a-dark-fr-390-menu', 'theme=dark&lang=fr&menu=open', { w: 390, h: 844 }, { clip: 'viewport' }),
  V('a-dark-fr-zoom200', 'theme=dark&lang=fr', { w: 720, h: 450 }, { scale: 2 }),
  // journey steps, desktop, viewport around the sticky stage
  V('a-dark-fr-1440-step2', 'theme=dark&lang=fr&step=2', { w: 1440, h: 900 }, { section: '#parcours' }),
  V('a-dark-fr-1440-step4', 'theme=dark&lang=fr&step=4', { w: 1440, h: 900 }, { section: '#parcours' }),
  V('a-light-fr-1440-step5', 'theme=light&lang=fr&step=5', { w: 1440, h: 900 }, { section: '#parcours' }),
  V('a-dark-en-1440-step6', 'theme=dark&lang=en&step=6', { w: 1440, h: 900 }, { section: '#parcours' }),
]

const browser = await chromium.launch()
let failures = 0
try {
  for (const v of VARIANTS) {
    if (only && v.name !== only) continue
    const theme = v.q.includes('theme=dark') ? 'dark' : 'light'
    const context = await browser.newContext({ viewport: { width: v.view.w, height: v.view.h }, deviceScaleFactor: v.scale || 1, colorScheme: theme, reducedMotion: v.reduced ? 'reduce' : 'no-preference', locale: v.q.includes('lang=en') ? 'en-CA' : 'fr-CA' })
    const tab = await context.newPage()
    const errors = []
    tab.on('pageerror', e => errors.push(e.message))
    await tab.goto(pathToFileURL(page).href + '?' + v.q + '&eager=1')
    await tab.evaluate(() => document.fonts.ready)
    await tab.waitForFunction(() => Array.from(document.images).every(i => i.complete), null, { timeout: 20000 })
    await tab.waitForTimeout(400)
    const file = resolve(out, `${v.name}.png`)
    if (v.section) {
      await tab.locator(v.section).scrollIntoViewIfNeeded()
      await tab.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); scrollBy(0, r.top - 40) }, v.section)
      await tab.waitForTimeout(300)
      await tab.screenshot({ path: file })
    } else {
      await tab.screenshot({ path: file, fullPage: v.clip !== 'viewport' })
    }
    const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const h1 = await tab.locator('h1').count()
    const axe = await new AxeBuilder({ page: tab }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    const violations = axe.violations.map(x => `${x.id}(${x.nodes.length})`)
    const bad = overflow > 0 || h1 !== 1 || violations.length || errors.length
    if (bad) failures++
    console.log(`${v.name.padEnd(28)} ${bad ? 'FAIL' : 'ok  '} overflow=${overflow}px h1=${h1} axe=${violations.length ? violations.join(' ') : 'none'}${errors.length ? ' errors=' + errors.join(' | ') : ''}`)
    await context.close()
  }
} finally {
  await browser.close()
}
process.exitCode = failures ? 1 : 0
