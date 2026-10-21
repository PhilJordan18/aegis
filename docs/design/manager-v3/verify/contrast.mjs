// Contraste WCAG 2.2 AA : (1) tous les textes visibles, mesurés sur les pixels rendus
// (texte rendu transparent, fond échantillonné sous la boîte de chaque ligne); (2) paires de jetons non textuels.
import { chromium, open, STATES, LANGS, THEMES, signInUrl, shellUrl, ratio, parseTok, hex, blend } from './lib.mjs'
import fs from 'node:fs'

const browser = await chromium.launch()
const out = { text: [], textWorst: [], tokens: {} }

async function scanText(page) {
  const items = await page.evaluate(() => {
    const res = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    const push = (label, b, cs, el) => {
      let op = 1, e = el
      while (e) { op *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement }
      res.push({ text: label.slice(0, 48), x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height, color: cs.color, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10), op, cls: (el.className && el.className.baseVal === undefined ? el.className : el.tagName) })
    }
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim()
      if (!t) continue
      const el = n.parentElement
      if (el.closest('.ag-sr-only,[hidden],script,style,title,dialog:not([open]),.ag-skip')) continue
      const dlg = document.querySelector('dialog[open]')
      if (dlg && !dlg.contains(el)) continue // le reste de la page est inerte sous un dialogue modal
      if (!el.checkVisibility({ checkVisibilityCSS: true })) continue
      const r = document.createRange(); r.selectNodeContents(n)
      const b = r.getBoundingClientRect()
      if (b.width < 2 || b.height < 2) continue
      push(t, b, getComputedStyle(el), el)
    }
    document.querySelectorAll('input').forEach((i) => {
      if (!i.value || !i.checkVisibility()) return
      const b = i.getBoundingClientRect()
      push('[input] ' + (i.type === 'password' ? '••••' : i.value), { x: b.x + 2, y: b.y + 8, width: Math.min(b.width - 4, 120), height: b.height - 16 }, getComputedStyle(i), i)
    })
    return res
  })
  await page.addStyleTag({ content: '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}' })
  const shot = await page.screenshot({ fullPage: true })
  const results = await page.evaluate(async ({ b64, items }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
    const L = (r, gg, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b) }
    return items.map((it) => {
      const m = it.color.match(/[\d.]+/g).map(Number); const a = (m[3] ?? 1) * it.op
      const x = Math.max(0, Math.floor(it.x)), y = Math.max(0, Math.floor(it.y))
      const w = Math.max(1, Math.min(img.width - x, Math.ceil(it.w))), h = Math.max(1, Math.min(img.height - y, Math.ceil(it.h)))
      const d = g.getImageData(x, y, w, h).data
      let min = 99, minBg = null
      for (let i = 0; i < d.length; i += 8) {
        const bg = [d[i], d[i + 1], d[i + 2]]
        const fg = [0, 1, 2].map((k) => m[k] * a + bg[k] * (1 - a))
        const l1 = L(...fg), l2 = L(...bg)
        const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        if (r < min) { min = r; minBg = bg }
      }
      return { ...it, ratio: Math.round(min * 100) / 100, bg: minBg }
    })
  }, { b64: shot.toString('base64'), items })
  return results.map((r) => ({ ...r, need: r.size >= 24 || (r.size >= 18.66 && r.weight >= 700) ? 3 : 4.5 }))
}

async function runPage(label, url, opts) {
  const { ctx, page } = await open(browser, url, opts)
  const res = await scanText(page)
  await ctx.close()
  const fails = res.filter((r) => r.ratio < r.need)
  const worst = res.reduce((a, b) => (b.ratio - b.need < a.ratio - a.need ? b : a), res[0])
  out.text.push({ label, n: res.length, fails: fails.map((f) => `${f.text} (${f.ratio} < ${f.need})`), worst: `${worst.text} ${worst.ratio}:1 (min ${worst.need})` })
  for (const r of res) out.textWorst.push({ label, text: r.text, cls: r.cls, size: r.size, ratio: r.ratio, need: r.need })
  console.log(label.padEnd(52), String(res.length).padStart(3), 'textes', fails.length ? 'ECHECS ' + fails.map((f) => f.text + ' ' + f.ratio).join(' | ') : 'ok', '| pire', worst.text, worst.ratio)
}

for (const theme of THEMES) for (const lang of LANGS) {
  for (const s of STATES) await runPage(`sign-in ${s} ${lang} ${theme} 1440`, signInUrl(s, lang, theme))
  await runPage(`sign-in nominal ${lang} ${theme} 390`, signInUrl('nominal', lang, theme), { width: 390, height: 844 })
  await runPage(`sign-in nominal+brand=mark ${lang} ${theme} 1440`, signInUrl('nominal', lang, theme, '&brand=mark'))
  await runPage(`shell ${lang} ${theme} 1440`, shellUrl(lang, theme))
  await runPage(`shell ${lang} ${theme} 390`, shellUrl(lang, theme), { width: 390, height: 844 })
  await runPage(`shell drawer ${lang} ${theme} 390`, shellUrl(lang, theme, '&drawer=1'), { width: 390, height: 844 })
}

// ---- Paires de jetons non textuels (valeurs résolues depuis les pages rendues) ----
for (const theme of THEMES) {
  const { ctx, page } = await open(browser, signInUrl('nominal', 'fr', theme))
  const t = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const o = {}
    for (const k of ['bg', 'top', 'panel', 'field', 'text', 'muted', 'border', 'accent', 'button', 'button-text', 'core', 'ring', 'error-bg', 'error-text', 'control-border', 'focus', 'selected', 'disabled-bg', 'disabled-text', 'warn-bg', 'warn-text', 'info-bg', 'info-text', 'ready-bg', 'ready-text', 'ready-icon', 'neutral-bg', 'neutral-text', 'glyph', 'halo']) o[k] = cs.getPropertyValue('--ag-' + k).trim()
    return o
  })
  await ctx.close()
  const c = (k) => parseTok(t[k]).rgb
  const haloOver = (base) => { const h = parseTok(t.halo); return blend(h.rgb, h.a, c(base)) }
  const ringOver = (base) => { const h = parseTok(t.ring); return blend(h.rgb, h.a, c(base)) }
  const R = (a, b) => Math.round(ratio(a, b) * 100) / 100
  const pairs = {
    'bordure de champ v3 (--border) / panneau (échoue 1.4.11)': R(c('border'), c('panel')),
    'bordure de champ v3 (--border) / champ (échoue 1.4.11)': R(c('border'), c('field')),
    'bordure de champ retenue (--control-border) / panneau': R(c('control-border'), c('panel')),
    'bordure de champ retenue / champ': R(c('control-border'), c('field')),
    'focus (plein) / panneau': R(c('focus'), c('panel')),
    'focus / champ': R(c('focus'), c('field')),
    'focus / bandeau (top)': R(c('focus'), c('top')),
    'focus / fond (bg)': R(c('focus'), c('bg')),
    'focus / élément sélectionné': R(c('focus'), c('selected')),
    'bague translucide v3 seule (--ring sur panneau) / panneau (non utilisée seule)': R(ringOver('panel'), c('panel')),
    'bouton principal / panneau (limite visuelle)': R(c('button'), c('panel')),
    'texte du bouton / bouton': R(c('button-text'), c('button')),
    'bordure d\'erreur (error-text) / panneau': R(c('error-text'), c('panel')),
    'bordure d\'erreur / champ': R(c('error-text'), c('field')),
    'icône d\'erreur (error-text) / fond d\'erreur': R(c('error-text'), c('error-bg')),
    'icône d\'avertissement / fond': R(c('warn-text'), c('warn-bg')),
    'icône d\'information / fond': R(c('info-text'), c('info-bg')),
    'icône « prêt » / fond de pastille': R(c('ready-icon'), c('ready-bg')),
    'symbole du logo (accent, A) / bandeau': R(c('accent'), c('top')),
    'symbole du logo (accent, A) / panneau': R(c('accent'), c('panel')),
    'noyau du logo (core) / bandeau': R(c('core'), c('top')),
    'noyau du logo (core) / bandeau sous le halo': R(c('core'), haloOver('top')),
    'noyau du logo (core) / panneau': R(c('core'), c('panel')),
    'texte secondaire / bandeau sous le halo': R(c('muted'), haloOver('top')),
    'texte / bandeau sous le halo': R(c('text'), haloOver('top')),
    'accent (« Prouvé. ») / bandeau sous le halo': R(c('accent'), haloOver('top')),
    'bouton verrouillé : texte / fond (indicatif, état désactivé exempté)': R(c('disabled-text'), c('disabled-bg')),
    'bouton verrouillé : fond / panneau (limite visuelle)': R(c('disabled-bg'), c('panel')),
  }
  out.tokens[theme] = { values: t, pairs }
  console.log('\n== jetons', theme)
  for (const [k, v] of Object.entries(pairs)) console.log(String(v).padStart(6), k)
}
// Pour mémoire : le symbole clair fourni sur fond sombre (raison du nouvel asset sombre).
{
  const lightMark = parseTok('#234bce').rgb, lightCore = parseTok('#087a9b').rgb, darkTop = parseTok('#070d17').rgb
  out.tokens.lightMarkOnDark = { accent: Math.round(ratio(lightMark, darkTop) * 100) / 100, core: Math.round(ratio(lightCore, darkTop) * 100) / 100 }
  console.log('\nsymbole clair sur fond sombre : A', out.tokens.lightMarkOnDark.accent, 'noyau', out.tokens.lightMarkOnDark.core)
}
await browser.close()
fs.writeFileSync(new URL('./results-contrast.json', import.meta.url), JSON.stringify(out, null, 1))
