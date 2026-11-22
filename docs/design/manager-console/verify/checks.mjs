// Contrôles du prototype « console Manager » (issue #158). Sortie : une ligne PASS ou FAIL par contrôle; code de sortie 1 au premier échec.
//  1. feuilles de l'application copiées sans écart (jetons, base, coque, composants);
//  2. FR et EN ont exactement les mêmes clés de texte;
//  3. la liste des états de chaque écran (lib.mjs) est celle du script de l'écran;
//  4. aucune requête réseau, aucune erreur de page, sur tous les écrans et états;
//  5. aucun défilement horizontal à 320, 390, 768, 1024 et 1440 px;
//  6. (hors panneau de revue et puces de filtre, qui portent des codes) aucun contrôle qui change un état de garde : pas de Résoudre, fin de prêt, confirmation, retour forcé, ouverture à distance;
//  7. un prêt en retard n'est jamais présenté comme disponible ni « Prêt »;
//  8. clavier : le lien d'évitement est le premier arrêt, et chaque arrêt de tabulation montre un contour de focus de 2 px;
//  9. la reconnaissance exige une note de 1 à 500 caractères (graphèmes).
// Usage : node docs/design/manager-console/verify/checks.mjs   (depuis la racine du dépôt)
import { chromium, open, url, PROTO, SCREENS, ROOT, HERE } from './lib.mjs'
import fs from 'node:fs'
import path from 'node:path'

let failed = 0
const pass = (m) => console.log('PASS', m)
const fail = (m) => { failed += 1; console.log('FAIL', m) }
const check = (ok, okMsg, koMsg) => (ok ? pass(okMsg) : fail(koMsg))

// ---- 1. feuilles copiées
const COPIES = [
  ['styles/tokens.css', 'tokens.css'], ['styles/base.css', 'base.css'], ['app/shell/shell.css', 'shell.css'], ['app/page.css', 'page.css'],
  ['features/catalog/equipment.css', 'equipment.css'], ['ui/alert.css', 'alert.css'], ['ui/button.css', 'button.css'], ['ui/dialog.css', 'dialog.css'],
  ['ui/form.css', 'form.css'], ['ui/status-chip.css', 'status-chip.css'], ['ui/brand.css', 'brand.css'],
]
const drift = COPIES.filter(([src, dst]) => !fs.readFileSync(path.join(ROOT, 'apps/admin-web/src', src)).equals(fs.readFileSync(path.join(HERE, '../prototype/css/app', dst))))
check(drift.length === 0, `${COPIES.length} feuilles de apps/admin-web/src copiées sans écart`, `écart avec l'application : ${drift.map((d) => d[0]).join(', ')}`)

// ---- 3. états déclarés
for (const [page, states] of Object.entries(SCREENS)) {
  const src = fs.readFileSync(path.join(HERE, `../prototype/js/${page}.js`), 'utf8')
  const declared = JSON.parse(/var STATES = (\[.*?\]);/s.exec(src)[1].replace(/'/g, '"'))
  check(JSON.stringify(declared) === JSON.stringify(states), `${page} : ${states.length} états déclarés`, `${page} : états du script ${declared} ≠ lib.mjs ${states}`)
}

const browser = await chromium.launch()

// ---- 2. parité FR / EN : les textes sont lus dans le navigateur, tels que le prototype les charge (aucune évaluation de code dans Node)
{
  const { ctx, page: p } = await open(browser, url('overview', { lang: 'fr', theme: 'light' }))
  const { fr, en } = await p.evaluate(() => JSON.parse(JSON.stringify(window.AG.copy, (_k, v) => (typeof v === 'function' ? '[function]' : v))))
  await ctx.close()
  const keys = (o, prefix = '') =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}:${v === '[function]' ? 'function' : typeof v}`]))
  const kf = new Set(keys(fr)), ke = new Set(keys(en))
  const onlyFr = [...kf].filter((k) => !ke.has(k)), onlyEn = [...ke].filter((k) => !kf.has(k))
  check(onlyFr.length === 0 && onlyEn.length === 0, `FR et EN ont les mêmes ${kf.size} clés`, `clés différentes : FR seul ${onlyFr.join(', ')}; EN seul ${onlyEn.join(', ')}`)
}


// ---- 4. réseau et erreurs de page : relevés pendant la passe 6 (une seule ouverture par page)
let pages = 0
const problems = []

// ---- 5. défilement horizontal
const overflow = []
for (const width of [320, 390, 768, 1024, 1440]) {
  for (const [page, extra] of [['overview', ''], ['reservations', '&tab=loans'], ['reservations', '&tab=operations'], ['anomalies', '&status=ALL'], ['audit', '&filters=1'], ['anomalies', '&dialog=1']]) {
    const { ctx, page: p } = await open(browser, url(page, { lang: 'fr', theme: 'light', extra }), { width, height: 800 })
    const w = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
    if (w.s > w.c) overflow.push(`${page}${extra} @${width}: ${w.s} > ${w.c}`)
    await ctx.close()
  }
}
check(overflow.length === 0, 'aucun défilement horizontal à 320, 390, 768, 1024 et 1440 px (6 vues)', overflow.join('\n'))

// ---- 6. aucun contrôle de garde, 7. retard, tout états confondus
const FORBIDDEN = /résoudre|resolve|terminer le prêt|end (the )?loan|forcer|force[- ]return|confirmer l'opération|confirm the operation|ouvrir à distance|déverrouiller|unlock|remote open|marquer disponible|mark (as )?available/i
const badControls = []
const lateIssues = []
for (const [page, states] of Object.entries(SCREENS)) {
  for (const state of states) {
    for (const lang of ['fr', 'en']) {
      const extra = page === 'reservations' ? '&tab=loans' : ''
      const { ctx, page: p, errors, external } = await open(browser, url(page, { state, lang, theme: 'light', extra: extra + (page === 'anomalies' ? '&dialog=1' : '') }))
      pages += 1
      if (errors.length || external.length) problems.push(`${page}/${state}/${lang}: ${errors.concat(external).join(' | ')}`)
      const controls = await p.evaluate(() => [...document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]')].filter((e) => !e.closest('.cs-review, .cs-band') && !e.hasAttribute('data-unfilter')).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()))
      for (const c of controls) if (FORBIDDEN.test(c)) badControls.push(`${page}/${state}/${lang}: « ${c} »`)
      if (page === 'reservations' || page === 'overview') {
        const rows = await p.evaluate(() => [...document.querySelectorAll('.ag-item, .cs-row')].filter((e) => /En retard|Overdue/.test(e.textContent)).map((e) => e.textContent))
        for (const r of rows) if (/Disponible|Available|\bPrêt\b(?! en retard)(?!s)|\bReady\b/.test(r.replace(/Retour prévu/g, ''))) lateIssues.push(`${page}/${state}/${lang}: ${r.slice(0, 80)}`)
      }
      await ctx.close()
    }
  }
}
check(problems.length === 0, `${pages} pages sans requête externe ni erreur de page`, problems.join('\n'))
check(badControls.length === 0, `aucun contrôle Résoudre, fin de prêt, confirmation, retour forcé ni ouverture à distance (${pages} pages, boutons et liens)`, badControls.join('\n'))
check(lateIssues.length === 0, 'un prêt en retard ne porte jamais « Disponible » ni « Prêt »', lateIssues.join('\n'))

// ---- 8. clavier
const kb = []
for (const [page, extra] of [['overview', ''], ['reservations', '&tab=loans'], ['anomalies', ''], ['audit', '&filters=1']]) {
  const { ctx, page: p } = await open(browser, url(page, { lang: 'fr', theme: 'dark', extra }))
  const seen = []
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press('Tab')
    const d = await p.evaluate(() => {
      const e = document.activeElement
      if (!e || e === document.body) return null
      const cs = getComputedStyle(e)
      const r = e.getBoundingClientRect()
      const label = (e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || e.id || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
      return { label, tag: e.tagName, outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), visible: r.width > 0 && r.height > 0, boxShadow: cs.boxShadow !== 'none', nativePicker: e.tagName === 'INPUT' && e.type === 'date' && !e.matches(':focus-visible') }
    })
    if (d) seen.push(d)
  }
  if (!seen.length || !/Aller au contenu/.test(seen[0].label)) kb.push(`${page}: premier arrêt « ${seen[0] && seen[0].label} »`)
  // Bouton calendrier natif d'un champ date : l'anneau est dessiné par le navigateur sur le bouton, vérifié à l'écran.
  for (const d of seen.filter((x) => !x.nativePicker)) if (!d.visible || (d.outline === 'none' && !d.boxShadow) || (d.outline !== 'none' && d.width < 2)) kb.push(`${page}: « ${d.label} » (${d.tag}) sans contour de 2 px`)
  console.log(`  ordre de tabulation ${page}${extra} : ${seen.slice(0, 14).map((d) => d.label).join(' → ')}`)
  await ctx.close()
}
check(kb.length === 0, 'clavier : lien d’évitement en premier, contour de focus de 2 px à chaque arrêt (4 écrans)', kb.join('\n'))

// ---- 9. note de reconnaissance
{
  const { ctx, page: p } = await open(browser, url('anomalies', { lang: 'fr', theme: 'light', extra: '&dialog=1' }))
  const out = []
  async function submit(text) {
    await p.fill('#ack-note', text)
    await p.click('#ack-submit')
    await p.waitForTimeout(150)
    return p.evaluate(() => ({ err: document.getElementById('ack-err')?.textContent.trim() || '', busy: !!document.querySelector('#ack-submit.is-busy'), invalid: document.getElementById('ack-note').getAttribute('aria-invalid') }))
  }
  let r = await submit('')
  if (!/Saisissez une note/.test(r.err) || r.invalid !== 'true') out.push('note vide acceptée')
  r = await submit('   ')
  if (!/Saisissez une note/.test(r.err)) out.push('note d’espaces acceptée')
  r = await submit('é'.repeat(501))
  if (!/au plus 500/.test(r.err)) out.push('501 caractères acceptés')
  r = await submit('é'.repeat(500)) // 500 graphèmes (1000 unités UTF-16)
  if (r.err !== '' || !r.busy) out.push('500 graphèmes refusés')
  check(out.length === 0, 'reconnaissance : note de 1 à 500 caractères (graphèmes), vide et espaces refusés', out.join(', '))
  await ctx.close()
}

await browser.close()
console.log(failed === 0 ? '\nTous les contrôles passent.' : `\n${failed} contrôle(s) en échec.`)
process.exit(failed === 0 ? 0 : 1)
