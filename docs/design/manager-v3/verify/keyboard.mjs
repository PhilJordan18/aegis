// Ordre de tabulation et focus visible : pour chaque arrêt, indicateur calculé et contraste mesuré sur les pixels
// (anneau de 2 px à l'extérieur de la boîte de l'élément ou de son champ, comparé au fond voisin).
import { chromium, open, signInUrl, shellUrl, ratio } from './lib.mjs'
import fs from 'node:fs'

const browser = await chromium.launch()
const report = []

async function tabThrough(label, url, opts = {}) {
  const { ctx, page } = await open(browser, url, opts)
  // Départ : début du document (le prototype donne le focus à un champ dans certains états).
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
  if (!url.includes('drawer')) await page.mouse.click(1, 1).catch(() => {})
  await page.evaluate(() => { document.activeElement?.blur() })
  const stops = []
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(60)
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const ctl = el.closest('.ag-field__control')
      const ringEl = ctl && el.tagName === 'INPUT' ? ctl : el
      const r = ringEl.getBoundingClientRect()
      const cs = getComputedStyle(ringEl)
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      const name = el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) || el.id
      return {
        tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), name,
        focusVisible: el.matches(':focus-visible'),
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} +${cs.outlineOffset}`,
        outlineWidth: parseFloat(cs.outlineWidth), outlineOffset: parseFloat(cs.outlineOffset),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        obscured: !(top === el || el.contains(top) || (ringEl.contains(top))),
        ariaDisabled: el.getAttribute('aria-disabled'),
      }
    })
    if (!info) break
    if (stops.length && stops[0].tag === info.tag && stops[0].name === info.name) break
    // Contraste de l'anneau : pixel à (gauche - décalage - 1 px) contre pixel de fond à 14 px.
    const shot = await page.screenshot()
    const px = await page.evaluate(async ({ b64, info }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
      const get = (x, y) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? null : Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)))
      const cy = Math.round(info.rect.y + info.rect.h / 2), cx = Math.round(info.rect.x + info.rect.w / 2)
      const o = info.outlineOffset + 1
      return {
        left: { ring: get(Math.round(info.rect.x - o), cy), bg: get(Math.round(info.rect.x - 14), cy) },
        top: { ring: get(cx, Math.round(info.rect.y - o)), bg: get(cx, Math.round(info.rect.y - 14)) },
        bottom: { ring: get(cx, Math.round(info.rect.y + info.rect.h + o - 1)), bg: get(cx, Math.round(info.rect.y + info.rect.h + 14)) },
      }
    }, { b64: shot.toString('base64'), info })
    // Anneau mesuré sur les pixels, contre le fond uni voisin : meilleur des côtés gauche, haut et bas (un côté peut toucher un élément voisin).
    const cands = ['left', 'top', 'bottom'].map((k) => (px[k].ring && px[k].bg ? Math.round(ratio(px[k].ring, px[k].bg) * 100) / 100 : null)).filter((v) => v !== null)
    const r = cands.length ? Math.max(...cands) : null
    stops.push({ ...info, ringRatio: r })
  }
  await ctx.close()
  const ok = stops.every((s) => s.focusVisible && s.outlineWidth >= 2 && !s.obscured && (s.ringRatio === null || s.ringRatio >= 3))
  report.push({ label, ok, stops })
  console.log(`\n${ok ? 'OK ' : 'ECHEC'} ${label}`)
  for (const s of stops) console.log(`  ${s.tag.padEnd(22)} ${s.name.padEnd(34)} visible:${s.focusVisible} anneau:${s.ringRatio}:1 ${s.outline} obscurci:${s.obscured}${s.ariaDisabled ? ' aria-disabled' : ''}`)
}

for (const theme of ['dark', 'light']) {
  await tabThrough(`sign-in nominal fr ${theme} 1440`, signInUrl('nominal', 'fr', theme, '&nofocus'))
  await tabThrough(`sign-in validation en ${theme} 1440`, signInUrl('validation', 'en', theme, '&nofocus'))
  await tabThrough(`sign-in rate-limited fr ${theme} 1440 (verrou, aria-disabled)`, signInUrl('rate-limited', 'fr', theme, '&nofocus'))
  await tabThrough(`sign-in role-unauthorized en ${theme} 1440`, signInUrl('role-unauthorized', 'en', theme))
  await tabThrough(`sign-in nominal fr ${theme} 390`, signInUrl('nominal', 'fr', theme, '&nofocus'), { width: 390, height: 844 })
  await tabThrough(`shell fr ${theme} 1440`, shellUrl('fr', theme))
  await tabThrough(`shell en ${theme} 390`, shellUrl('en', theme), { width: 390, height: 844 })
  await tabThrough(`shell drawer fr ${theme} 390`, shellUrl('fr', theme, '&drawer=1'), { width: 390, height: 844 })
}
// Tiroir : Échap ferme et rend le focus au bouton Menu; le sélecteur de langue s'active au clavier (Entrée) sans perdre le focus.
{
  const { ctx, page } = await open(browser, shellUrl('fr', 'dark'), { width: 390, height: 844 })
  await page.click('#menu-btn'); await page.waitForTimeout(100)
  const first = await page.evaluate(() => document.activeElement?.id)
  await page.keyboard.press('Escape'); await page.waitForTimeout(100)
  const after = await page.evaluate(() => ({ open: document.querySelector('dialog').open, focus: document.activeElement?.id }))
  await ctx.close()
  const ctx2 = await open(browser, signInUrl('invalid-credentials', 'fr', 'dark', '&nofocus'))
  await ctx2.page.focus('.si__lang button[data-lang="en"]'); await ctx2.page.keyboard.press('Enter'); await ctx2.page.waitForTimeout(100)
  const lang = await ctx2.page.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelector('h1').textContent, focus: document.activeElement?.dataset.lang, pressed: document.activeElement?.getAttribute('aria-pressed'), alert: document.querySelector('.ag-alert__title')?.textContent }))
  await ctx2.ctx.close()
  report.push({ label: 'tiroir et langue', drawerFirstFocus: first, afterEscape: after, langSwitch: lang })
  console.log('\nTiroir : focus initial', first, '| après Échap', JSON.stringify(after), '\nLangue au clavier :', JSON.stringify(lang))
}
await browser.close()
fs.writeFileSync(new URL('./results-keyboard.json', import.meta.url), JSON.stringify(report, null, 1))
