// Aides communes des vérifications du prototype (issue #79).
// Playwright est pris dans apps/admin-web/node_modules (npm ci, aucun fichier modifié).
import { chromium } from '../../../../apps/admin-web/node_modules/playwright-core/index.mjs'
import AxeBuilder from '../../../../apps/admin-web/node_modules/@axe-core/playwright/dist/index.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export { chromium, AxeBuilder }
export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PROTO = 'file://' + path.resolve(HERE, '../prototype') + '/'
export const CAPTURES = path.resolve(HERE, '../captures')

export const STATES = [
  'nominal', 'sending', 'invalid-credentials', 'validation', 'rate-limited',
  'unreachable', 'service-error', 'session-expired', 'role-unauthorized',
]
export const LANGS = ['fr', 'en']
export const THEMES = ['dark', 'light']

export function signInUrl(state, lang, theme, extra = '') {
  return `${PROTO}sign-in.html?state=${state}&lang=${lang}&theme=${theme}&still${extra}`
}
export function shellUrl(lang, theme, extra = '') {
  return `${PROTO}shell.html?lang=${lang}&theme=${theme}${extra}`
}

export async function open(browser, url, { width = 1440, height = 900, scale = 1, reduced = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('requestfailed', (r) => errors.push('requestfailed ' + r.url()))
  const external = []
  page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) external.push(r.url()) })
  await page.goto(url)
  await page.waitForSelector('body[data-ready]')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  return { ctx, page, errors, external }
}

export const lum = (rgb) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
export const hex = (s) => { s = s.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) }
export const blend = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a))
export const ratio = (a, b) => {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** Jeton CSS de 6 ou 8 chiffres : rgb et alpha. */
export const parseTok = (s) => {
  s = s.trim()
  const rgb = hex(s)
  const a = s.length >= 9 ? parseInt(s.slice(7, 9), 16) / 255 : 1
  return { rgb, a }
}
