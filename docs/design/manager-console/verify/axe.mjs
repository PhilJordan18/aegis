// axe-core (WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA et bonnes pratiques) sur chaque page du prototype, dans les deux apparences.
// Matrice : chaque écran × chaque état × {FR sombre 1440, EN clair 1440, FR clair 390, EN sombre 390},
// plus l'index, les onglets Prêts et Opérations, le dialogue ouvert (clair et sombre) et le panneau de filtres de l'audit ouvert.
// Usage : node verify/axe.mjs   (depuis la racine du dépôt, après `npm ci` dans apps/admin-web)
import { chromium, AxeBuilder, open, url, PROTO, SCREENS } from './lib.mjs'
import fs from 'node:fs'

const browser = await chromium.launch()
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
const COMBOS = [
  { lang: 'fr', theme: 'dark', width: 1440, height: 900 },
  { lang: 'en', theme: 'light', width: 1440, height: 900 },
  { lang: 'fr', theme: 'light', width: 390, height: 844 },
  { lang: 'en', theme: 'dark', width: 390, height: 844 },
]
let runs = 0
let violationRuns = 0
let violationNodes = 0
let incompleteRules = 0
const themes = { dark: 0, light: 0 }
const details = []

async function run(label, target, vp, theme, after) {
  const { ctx, page, errors } = await open(browser, target, vp)
  if (after) await after(page)
  // axe relit lui-même les feuilles de style (XHR file:// refusé par Chromium) : seules les erreurs d'avant l'analyse comptent.
  const pageErrors = [...errors]
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  await ctx.close()
  runs += 1
  themes[theme] += 1
  if (r.violations.length) violationRuns += 1
  violationNodes += r.violations.reduce((n, v) => n + v.nodes.length, 0)
  incompleteRules += r.incomplete.length
  if (r.violations.length || r.incomplete.length || pageErrors.length) {
    details.push({
      label,
      violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 3) })),
      incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 3) })),
      errors: pageErrors,
    })
  }
}

await Promise.all(COMBOS.map(async (c) => {
  const vp = { width: c.width, height: c.height }
  const tag = `${c.lang} ${c.theme} ${c.width}`
  await run(`index ${tag}`, `${PROTO}index.html?lang=${c.lang}&theme=${c.theme}`, vp, c.theme)
  for (const [page, states] of Object.entries(SCREENS)) {
    for (const state of states) await run(`${page} ${state} ${tag}`, url(page, { state, lang: c.lang, theme: c.theme }), vp, c.theme)
  }
  for (const tab of ['loans', 'operations']) await run(`reservations ${tab} ${tag}`, url('reservations', { lang: c.lang, theme: c.theme, extra: `&tab=${tab}` }), vp, c.theme)
  await run(`anomalies all ${tag}`, url('anomalies', { lang: c.lang, theme: c.theme, extra: '&status=ALL' }), vp, c.theme)
  await run(`anomalies dialog ${tag}`, url('anomalies', { lang: c.lang, theme: c.theme, extra: '&dialog=1' }), vp, c.theme)
  await run(`anomalies dialog erreur de champ ${tag}`, url('anomalies', { state: 'ack-validation', lang: c.lang, theme: c.theme, extra: '&dialog=1&note=x' }), vp, c.theme, async (p) => {
    await p.click('#ack-submit')
    await p.waitForSelector('#ack-err-msg')
  })
  await run(`audit filtres ouverts ${tag}`, url('audit', { lang: c.lang, theme: c.theme, extra: '&filters=1' }), vp, c.theme)
  if (c.width < 1024) await run(`shell tiroir ${tag}`, url('overview', { lang: c.lang, theme: c.theme, extra: '&drawer=1' }), vp, c.theme)
}))
await browser.close()

console.log(JSON.stringify(details, null, 1))
console.log(`\n${runs} pages analysées (${themes.dark} sombres, ${themes.light} claires)`)
console.log(`${violationRuns} page(s) avec violation, ${violationNodes} noeud(s) en violation`)
console.log(`${incompleteRules} règle(s) « à vérifier » (incomplete)`)
fs.writeFileSync(new URL('./results-axe.json', import.meta.url), JSON.stringify({ runs, themes, violationRuns, violationNodes, incompleteRules, details }, null, 1))
process.exit(violationNodes > 0 ? 1 : 0)
