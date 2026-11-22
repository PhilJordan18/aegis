// Aides communes des vérifications du prototype « console Manager » (issue #158).
// Playwright et axe sont pris dans apps/admin-web/node_modules (npm ci; aucun fichier de l'application n'est modifié).
import { chromium } from '../../../../apps/admin-web/node_modules/playwright-core/index.mjs'
import AxeBuilder from '../../../../apps/admin-web/node_modules/@axe-core/playwright/dist/index.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export { chromium, AxeBuilder }
export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '../../../..')
export const PROTO = 'file://' + path.resolve(HERE, '../prototype') + '/'
export const CAPTURES = path.resolve(HERE, '../captures')

export const LANGS = ['fr', 'en']
export const THEMES = ['dark', 'light']

/** États de chaque écran (page → états). Doit rester identique à la liste `STATES` du script de l'écran. */
export const SCREENS = {
  overview: ['nominal', 'loading', 'all-clear', 'locker-offline', 'locker-unknown', 'partial', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized'],
  reservations: ['nominal', 'loading', 'empty', 'partial', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized', 'detail-404', 'join-failed'],
  anomalies: ['nominal', 'loading', 'empty', 'partial', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized', 'detail-404', 'join-failed', 'ack-resolved', 'ack-not-acknowledgeable', 'ack-validation', 'ack-unreachable'],
  audit: ['nominal', 'loading', 'empty', 'partial', 'invalid-cursor', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized'],
}

export function url(page, { state = 'nominal', lang = 'fr', theme = 'dark', extra = '' } = {}) {
  return `${PROTO}${page}.html?state=${state}&lang=${lang}&theme=${theme}${extra}`
}

export async function open(browser, target, { width = 1440, height = 900, scale = 1, reduced = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
  })
  const page = await ctx.newPage()
  const errors = []
  const external = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()) })
  page.on('requestfailed', (r) => errors.push('requestfailed ' + r.url()))
  page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) external.push(r.url()) })
  await page.goto(target)
  await page.waitForSelector('body[data-ready]')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  return { ctx, page, errors, external }
}

