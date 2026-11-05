// Aucune clé de traduction ni texte non traduit visible : pour chaque page, tout texte visible, nom accessible et titre
// doit appartenir au dictionnaire de la langue demandée; aucun texte propre à l'autre langue ne doit apparaître.
import { chromium, open, STATES, LANGS, THEMES, signInUrl, shellUrl } from './lib.mjs'
import fs from 'node:fs'
const browser = await chromium.launch()
const copy = await (async () => {
  const { ctx, page } = await open(browser, signInUrl('nominal', 'fr', 'dark'))
  const c = await page.evaluate(() => {
    const flat = (o) => { const out = {}; for (const [k, v] of Object.entries(o)) { if (typeof v === 'function') out[k] = [v(55), v('0:55'), v(1)].map(String); else if (Array.isArray(v)) out[k] = v.flat().map((x) => typeof x === 'object' ? Object.values(x) : x).flat(); else out[k] = [String(v)] } return out }
    return { fr: flat(window.AEGIS_COPY.fr), en: flat(window.AEGIS_COPY.en) }
  })
  await ctx.close(); return c
})()
const allowedShared = new Set(['Aegis Manager', 'aegis', 'Manager', 'Audit', 'Anomalies', 'AD', 'FR', 'EN', 'Aegis', '2', 'MM-001', 'MM-002', 'Casier AEGIS-DEMO-01', 'technician@aegis.demo', 'revue@apercu.test', 'Français', 'English', ', à venir', ', coming soon'])  // endonymes du sélecteur de langue; texte masqué « , à venir »
const out = []
let problems = 0
for (const lang of LANGS) {
  const other = lang === 'fr' ? 'en' : 'fr'
  const mine = new Set(Object.values(copy[lang]).flat().map((s) => s.trim()))
  const theirs = new Set(Object.values(copy[other]).flat().map((s) => s.trim()).filter((s) => s && !mine.has(s) && !allowedShared.has(s)))
  const urls = []
  for (const theme of THEMES) {
    for (const s of STATES) urls.push([`sign-in ${s} ${lang} ${theme}`, signInUrl(s, lang, theme, '&nofocus')])
    urls.push([`shell ${lang} ${theme}`, shellUrl(lang, theme)], [`shell tiroir ${lang} ${theme}`, shellUrl(lang, theme, '&drawer=1')])
  }
  for (const [label, url] of urls) {
    const { ctx, page } = await open(browser, url, { width: label.includes('shell') ? 390 : 1440, height: 900 })
    const texts = await page.evaluate(() => {
      const t = [], dlg = document.querySelector('dialog[open]')
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n
      while ((n = walker.nextNode())) { const s = n.textContent.trim(); if (s && n.parentElement.closest('script,style') == null) t.push(s) }
      document.querySelectorAll('[aria-label]').forEach((e) => t.push(e.getAttribute('aria-label')))
      t.push(document.title, document.documentElement.lang)
      return t
    })
    await ctx.close()
    const issues = []
    for (const t of texts) {
      if (/^[a-z]+(\.[A-Za-z]+)+$/.test(t) || /\b(undefined|null|NaN|\[object)\b/.test(t) || /\{\{|\}\}/.test(t)) issues.push(`clé ou valeur brute: ${t}`)
      if (theirs.has(t)) issues.push(`texte de l'autre langue: ${t}`)
      const parts = t.split(/(?<=[.:?])\s+/)
      for (const p of parts) if (theirs.has(p.trim())) issues.push(`phrase de l'autre langue: ${p}`)
    }
    // Les textes visibles doivent venir du dictionnaire (hors codes, courriels, valeurs de démonstration).
    const unknown = texts.filter((t) => !mine.has(t) && !allowedShared.has(t) && !/^[0-9a-f]{32}$/.test(t) && !/^\d+:\d{2}$/.test(t) && !/^◇/.test(t) && !/^(fr|en|fr-CA)$/.test(t) && !/^Disponible dans|^Available in|^Réessayez dans \d+|^Try again in \d+/.test(t))
    for (const u of unknown) issues.push(`texte hors dictionnaire: ${u}`)
    out.push({ label, n: texts.length, issues: [...new Set(issues)] })
    if (issues.length) { problems += issues.length; console.log('PROBLEME', label, [...new Set(issues)].join(' | ')) }
  }
}
await browser.close()
console.log(`\n${out.length} pages, ${problems} problème(s)`)
fs.writeFileSync(new URL('./results-i18n.json', import.meta.url), JSON.stringify({ pages: out.length, problems, bad: out.filter((o) => o.issues.length) }, null, 1))
