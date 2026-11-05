// Captures soignées (1x, PNG) : <écran>-<état>-<langue>-<apparence>-<taille>.png dans ../captures/
import { chromium, open, signInUrl, shellUrl, CAPTURES, PROTO } from './lib.mjs'
import fs from 'node:fs'
fs.mkdirSync(CAPTURES, { recursive: true })
const browser = await chromium.launch()
const D = { width: 1440, height: 900 }, M = { width: 390, height: 844 }, XS = { width: 320, height: 640 }
const Z = { width: 640, height: 400, scale: 2 } // zoom 200 % d'une fenêtre de 1280 × 800
const list = [
  // [nom, url, viewport, touches Tab avant la capture, pleine page]
  ['sign-in-nominal-fr-dark-1440', signInUrl('nominal', 'fr', 'dark'), D],
  ['sign-in-nominal-fr-light-1440', signInUrl('nominal', 'fr', 'light'), D],
  ['sign-in-nominal-en-dark-1440', signInUrl('nominal', 'en', 'dark'), D],
  ['sign-in-nominal-en-light-1440', signInUrl('nominal', 'en', 'light'), D],
  ['sign-in-focus-fr-dark-1440', signInUrl('nominal', 'fr', 'dark', '&nofocus'), D, 8],
  ['sign-in-focus-en-light-1440', signInUrl('nominal', 'en', 'light', '&nofocus'), D, 5],
  ['sign-in-sending-fr-dark-1440', signInUrl('sending', 'fr', 'dark'), D],
  ['sign-in-invalid-credentials-fr-light-1440', signInUrl('invalid-credentials', 'fr', 'light'), D],
  ['sign-in-validation-en-dark-1440', signInUrl('validation', 'en', 'dark'), D],
  ['sign-in-rate-limited-fr-dark-1440', signInUrl('rate-limited', 'fr', 'dark'), D],
  ['sign-in-service-error-en-dark-1440', signInUrl('service-error', 'en', 'dark'), D],
  ['sign-in-unreachable-fr-light-1440', signInUrl('unreachable', 'fr', 'light'), D],
  ['sign-in-session-expired-fr-dark-1440', signInUrl('session-expired', 'fr', 'dark'), D],
  ['sign-in-role-unauthorized-en-light-1440', signInUrl('role-unauthorized', 'en', 'light'), D],
  ['sign-in-nominal-fr-dark-390', signInUrl('nominal', 'fr', 'dark'), M, 0, true],
  ['sign-in-nominal-en-light-390', signInUrl('nominal', 'en', 'light'), M, 0, true],
  ['sign-in-invalid-credentials-fr-dark-390', signInUrl('invalid-credentials', 'fr', 'dark'), M, 0, true],
  ['sign-in-service-error-fr-light-390', signInUrl('service-error', 'fr', 'light'), M, 0, true],
  ['sign-in-rate-limited-en-light-320', signInUrl('rate-limited', 'en', 'light'), XS, 0, true],
  ['sign-in-validation-fr-light-zoom200', signInUrl('validation', 'fr', 'light'), Z, 0, true],
  ['shell-header-fr-dark-1440', shellUrl('fr', 'dark'), D],
  ['shell-header-en-light-1440', shellUrl('en', 'light'), D],
  ['shell-header-fr-dark-390', shellUrl('fr', 'dark'), M],
  ['shell-header-drawer-en-light-390', shellUrl('en', 'light', '&drawer=1'), M],
]
for (const [name, url, vp, tabs = 0, full = false] of list) {
  const { ctx, page } = await open(browser, url, vp)
  if (tabs) { await page.mouse.click(1, 1); for (let i = 0; i < tabs; i++) await page.keyboard.press('Tab'); await page.waitForTimeout(100) }
  await page.screenshot({ path: `${CAPTURES}/${name}.png`, fullPage: full })
  await ctx.close()
}
{ // lisibilité du logo (page d'essai, hors rendu produit)
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 700 } }); const p = await ctx.newPage()
  await p.goto(PROTO + 'logo-sizes.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300)
  await p.screenshot({ path: `${CAPTURES}/logo-legibilite-fr-dark-light-1400.png`, fullPage: true }); await ctx.close()
}
await browser.close()
console.log(fs.readdirSync(CAPTURES).length, 'captures')
