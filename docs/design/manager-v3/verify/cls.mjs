// Saut de mise en page à l'apparition d'une erreur : déplacement vertical (px) des champs, du bouton et de la carte,
// avec l'alerte sous le bouton (alert=bottom, proposition) et au-dessus du formulaire (alert=top, état validé de states.md).
import { chromium, open, PROTO } from './lib.mjs'
import fs from 'node:fs'
const browser = await chromium.launch()
const rows = []
const SEL = ['#email', '#password', '#reveal', '#submit', '.si__card']
async function rects(page) {
  return page.evaluate((sel) => Object.fromEntries(sel.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, { y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }] })), SEL)
}
const shift = (a, b) => {
  const out = {}
  for (const s of SEL) out[s] = Math.round((b[s].y - a[s].y) * 10) / 10
  return out
}
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const mode of ['bottom', 'top']) {
    for (const lang of ['fr', 'en']) {
      const url = `${PROTO}sign-in.html?state=nominal&lang=${lang}&theme=dark&alert=${mode}&nofocus`
      const { ctx, page } = await open(browser, url, { ...vp, reduced: true })
      await page.evaluate(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) })
      const base = await rects(page)
      for (const target of ['invalid-credentials', 'rate-limited', 'unreachable', 'service-error', 'session-expired', 'validation', 'sending']) {
        await page.evaluate(() => AEGIS_TEST.show('nominal'))
        const a = await rects(page)
        await page.evaluate((t) => AEGIS_TEST.show(t), target)
        await page.waitForTimeout(80)
        const b = await rects(page)
        const d = shift(a, b)
        const fieldsMoved = Math.max(Math.abs(d['#email']), Math.abs(d['#password']), Math.abs(d['#reveal']), Math.abs(d['#submit']), Math.abs(d['.si__card']))
        rows.push({ viewport: vp.width, mode, lang, to: target, shifts: d, maxInteractiveShift: fieldsMoved })
      }
      // Parcours réel : champ vide -> validation; puis envoi -> envoi en cours -> identifiants refusés.
      await page.evaluate(() => AEGIS_TEST.show('nominal'))
      const r0 = await rects(page)
      await page.click('#submit'); await page.waitForTimeout(80)
      const r1 = await rects(page)
      await page.fill('#email', 'revue@apercu.test'); await page.fill('#password', 'x'); await page.waitForTimeout(80)
      const r2 = await rects(page)
      await page.click('#submit'); await page.waitForTimeout(150)
      const r3 = await rects(page)
      await page.waitForTimeout(1100)
      const r4 = await rects(page)
      const flow = { 'vide → validation': shift(r0, r1), 'correction → saisie': shift(r1, r2), 'saisie → envoi': shift(r2, r3), 'envoi → identifiants refusés': shift(r3, r4) }
      rows.push({ viewport: vp.width, mode, lang, to: 'parcours', flow })
      await ctx.close()
    }
  }
}
await browser.close()
// Synthèse
for (const vp of [1440, 390]) for (const mode of ['bottom', 'top']) {
  const sel = rows.filter((r) => r.viewport === vp && r.mode === mode && r.maxInteractiveShift !== undefined)
  const worst = sel.reduce((a, b) => (b.maxInteractiveShift > a.maxInteractiveShift ? b : a))
  const per = Object.fromEntries(['invalid-credentials', 'rate-limited', 'unreachable', 'service-error', 'session-expired', 'validation', 'sending'].map((t) => [t, Math.max(...sel.filter((r) => r.to === t).map((r) => r.maxInteractiveShift))]))
  console.log(`${vp}px alert=${mode} : décalage max des éléments interactifs ou de la carte (px) par transition`, JSON.stringify(per))
}
for (const r of rows.filter((r) => r.to === 'parcours' && r.lang === 'fr')) console.log(`parcours ${r.viewport}px alert=${r.mode}:`, JSON.stringify(Object.fromEntries(Object.entries(r.flow).map(([k, v]) => [k, `email ${v['#email']} / mdp ${v['#password']} / bouton ${v['#submit']} / carte ${v['.si__card']}`]))))
fs.writeFileSync(new URL('./results-cls.json', import.meta.url), JSON.stringify(rows, null, 1))
