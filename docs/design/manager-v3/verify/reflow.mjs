// Reflow, zoom à 200 %, largeurs étroites : défilement horizontal, débordement et rognage du texte, cibles de 24 px.
import { chromium, open, STATES, LANGS, THEMES, signInUrl, shellUrl } from './lib.mjs'
import fs from 'node:fs'

const browser = await chromium.launch()
const VIEWPORTS = [
  { name: 'zoom200 (1280×800 à 200 % = 640×400 px CSS)', width: 640, height: 400, scale: 2 },
  { name: '390', width: 390, height: 844, scale: 1 },
  { name: '320', width: 320, height: 640, scale: 1 },
  { name: '768', width: 768, height: 1024, scale: 1 },
  { name: '1024', width: 1024, height: 768, scale: 1 },
  { name: '1440', width: 1440, height: 900, scale: 1 },
]
const results = []
let bad = 0

async function inspect(page) {
  return page.evaluate(() => {
    const issues = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth + 0.5) issues.push(`défilement horizontal: scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`)
    const dlg = document.querySelector('dialog[open]')
    const vis = (el) => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('.ag-sr-only,[hidden],.ag-skip')
    const containers = '.ag-btn,.ag-alert,.ag-chip,.ag-field__control,.sh-account,.sh-nav a,.sh-nav .sh-nav__item,.si__lang button,.ag-brand,.ag-mock,.sh__mockband,.sh__row,.si__card'
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim(); if (!t) continue
      const el = n.parentElement
      if (!vis(el)) continue
      if (dlg && !dlg.contains(el)) continue
      const r = document.createRange(); r.selectNodeContents(n)
      const b = r.getBoundingClientRect(); if (b.width < 1) continue
      if (b.right > innerWidth + 0.5 || b.left < -0.5) issues.push(`texte hors écran: « ${t.slice(0, 30)} » (${Math.round(b.left)}–${Math.round(b.right)})`)
      const c = el.closest(containers)
      if (c) {
        const cb = c.getBoundingClientRect() // tolérance verticale de 3 px : la boîte de contenu d'une police dépasse sa ligne sans rogner le glyphe
        if (b.right > cb.right + 1 || b.left < cb.left - 1 || b.bottom > cb.bottom + 3 || b.top < cb.top - 3) issues.push(`texte rogné/débordant de ${c.className.toString().slice(0, 24)}: « ${t.slice(0, 30)} »`)
      }
    }
    document.querySelectorAll('a[href],button,input,[tabindex]').forEach((el) => {
      if (!vis(el)) return
      if (dlg && !dlg.contains(el)) return
      const b = el.getBoundingClientRect()
      const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline'
      if (!inline && (b.width < 24 || b.height < 24)) issues.push(`cible < 24 px: ${el.tagName.toLowerCase()}#${el.id || el.className} ${Math.round(b.width)}×${Math.round(b.height)}`)
    })
    document.querySelectorAll('body *').forEach((el) => {
      if (!vis(el) || (dlg && !dlg.contains(el))) return
      const cs = getComputedStyle(el)
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('ag-mark')) issues.push(`contenu masqué par overflow: ${el.className}`)
    })
    return issues
  })
}

async function run(label, url, vp) {
  const { ctx, page } = await open(browser, url, vp)
  const issues = await inspect(page)
  await ctx.close()
  results.push({ label, issues })
  if (issues.length) { bad++; console.log('ECHEC', label, '\n   ', [...new Set(issues)].join('\n    ')) }
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) for (const lang of LANGS) {
    for (const s of STATES) await run(`sign-in ${s} ${lang} ${theme} ${vp.name}`, signInUrl(s, lang, theme, '&nofocus'), vp)
    await run(`shell ${lang} ${theme} ${vp.name}`, shellUrl(lang, theme), vp)
    if (vp.width <= 1023) await run(`shell tiroir ${lang} ${theme} ${vp.name}`, shellUrl(lang, theme, '&drawer=1'), vp)
  }
}
await browser.close()
const total = results.length
console.log(`\n${total} rendus inspectés, ${bad} avec problème(s)`)
fs.writeFileSync(new URL('./results-reflow.json', import.meta.url), JSON.stringify({ total, bad, results: results.filter((r) => r.issues.length) }, null, 1))
