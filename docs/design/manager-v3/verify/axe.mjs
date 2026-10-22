// axe-core (WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA) sur le rendu de chaque état, langue et apparence.
import { chromium, AxeBuilder, open, STATES, LANGS, THEMES, signInUrl, shellUrl } from './lib.mjs'
import fs from 'node:fs'
const browser = await chromium.launch()
const rows = []
let violations = 0, incompleteTotal = 0
async function run(label, url, vp) {
  const { ctx, page } = await open(browser, url, vp)
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze()
  await ctx.close()
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.map((n) => n.target.join(' ')).slice(0, 4) }))
  const inc = r.incomplete.map((x) => ({ id: x.id, nodes: x.nodes.length }))
  rows.push({ label, violations: v, incomplete: inc, passes: r.passes.length })
  violations += v.length; incompleteTotal += inc.length
  if (v.length || inc.length) console.log(label, 'VIOLATIONS', JSON.stringify(v), 'INCOMPLETE', JSON.stringify(inc))
}
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const theme of THEMES) for (const lang of LANGS) {
    for (const s of STATES) await run(`sign-in ${s} ${lang} ${theme} ${vp.width}`, signInUrl(s, lang, theme, '&nofocus'), vp)
    await run(`shell ${lang} ${theme} ${vp.width}`, shellUrl(lang, theme), vp)
    if (vp.width < 1024) await run(`shell tiroir ${lang} ${theme} ${vp.width}`, shellUrl(lang, theme, '&drawer=1'), vp)
  }
}
await browser.close()
console.log(`\n${rows.length} pages, ${violations} violation(s), ${incompleteTotal} point(s) à vérifier (incomplete)`)
fs.writeFileSync(new URL('./results-axe.json', import.meta.url), JSON.stringify({ pages: rows.length, violations, incompleteTotal, rows: rows.filter((r) => r.violations.length || r.incomplete.length) }, null, 1))
