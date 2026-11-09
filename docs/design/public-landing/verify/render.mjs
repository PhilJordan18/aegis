/*
 * Renders the static compositions of docs/design/public-landing/ with the Playwright
 * Chromium of apps/admin-web (run `npm ci --ignore-scripts` there first):
 *   node docs/design/public-landing/verify/render.mjs [--only <file-stem>]
 * Writes PNGs at 1× into ../directions/renders/ and ../wireframes/renders/.
 * No network: fonts and scripts are local files.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const require = createRequire(resolve(here, '../../../../apps/admin-web/package.json'))
const { chromium } = require('@playwright/test')

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

const PAGES = [
  { dir: 'wireframes', stem: 'wireframes', views: [{ w: 1440, h: 900 }], themes: ['light'] },
  { dir: 'directions', stem: 'a-mise-en-scene', views: [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 390, h: 844 }], themes: ['dark', 'light'] },
  { dir: 'directions', stem: 'b-dossier-technique', views: [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 390, h: 844 }], themes: ['light', 'dark'] },
]

const browser = await chromium.launch()
try {
  for (const page of PAGES) {
    if (only && page.stem !== only) continue
    const out = resolve(root, page.dir, 'renders')
    mkdirSync(out, { recursive: true })
    for (const theme of page.themes) {
      for (const view of page.views) {
        const context = await browser.newContext({ viewport: { width: view.w, height: view.h }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', locale: 'fr-CA' })
        const tab = await context.newPage()
        const url = pathToFileURL(resolve(root, page.dir, `${page.stem}.html`)).href + `?theme=${theme}`
        await tab.goto(url)
        await tab.evaluate(() => document.fonts.ready)
        await tab.waitForTimeout(150)
        const file = resolve(out, `${page.stem}-${theme}-${view.w}.png`)
        await tab.screenshot({ path: file, fullPage: true })
        const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        console.log(`${page.stem} ${theme} ${view.w}px → ${file.replace(root + '/', '')}${overflow > 0 ? `  HORIZONTAL OVERFLOW ${overflow}px` : ''}`)
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}
