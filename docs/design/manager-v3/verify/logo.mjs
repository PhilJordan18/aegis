// Logo : (1) rendu du texte des signatures SVG fournies (non utilisées dans l'application, mesure demandée par l'issue);
// (2) lisibilité du symbole fourni à petite taille, sur les deux fonds, à 1x et 2x.
import { chromium, ratio, PROTO } from './lib.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.resolve(HERE, '../../identite/assets')
const browser = await chromium.launch()
const out = { lockup: {}, mark: [] }

// (1) Texte vivant des signatures : police réellement utilisée, et position du texte avec des polices de repli plus larges.
const page = await browser.newPage({ viewport: { width: 900, height: 400 } })
const cdp = await page.context().newCDPSession(page)
for (const file of ['aegis-core-logo.svg', 'aegis-core-logo-dark.svg']) {
  const svg = fs.readFileSync(path.join(ASSETS, file), 'utf8')
  for (const [name, family] of [['tel que fourni (Inter, Arial, sans-serif)', null], ['repli Verdana (plus large)', 'Verdana']]) {
    const fam = family
    const markup = fam ? svg.replace(/font-family="[^"]*"/g, `font-family="${fam}"`) : svg
    await page.setContent(`<style>@font-face{font-family:Geist;src:url(${PROTO}fonts/geist-latin-wght-normal.woff2);font-weight:100 900}body{margin:0;background:#fff}svg{width:400px;height:100px}</style>${markup}`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(200)
    const m = await page.evaluate(() => {
      const t = [...document.querySelectorAll('svg text')].map((e) => { const b = e.getBBox(); return { text: e.textContent, x: Math.round(b.x * 10) / 10, right: Math.round((b.x + b.width) * 10) / 10 } })
      return t
    })
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'svg text' })
    const fonts = []
    for (const id of nodeIds) { const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id }); fonts.push(r.fonts.map((f) => f.familyName + (f.isCustomFont ? ' (webfont)' : ' (système)'))) }
    const aegis = m[0], core = m[1]
    out.lockup[`${file} | ${name}`] = { aegisRight: aegis.right, separatorX: 255, gapToSeparator: Math.round((255 - aegis.right) * 10) / 10, coreRight: core.right, viewBoxWidth: 400, fonts: fonts.map((f) => f.join('+')) }
  }
}
console.log('Signatures SVG (texte vivant), coordonnées dans le viewBox 400 × 100 :')
for (const [k, v] of Object.entries(out.lockup)) console.log(' ', k, JSON.stringify(v))

// (2) Symbole : taille du noyau et contraste mesuré sur pixels.
const bgs = { 'sombre (page #070C13)': ['#070c13', 'aegis-core-mark-dark.svg', [100, 216, 235], [140, 174, 255]], 'sombre (carte #0E1621)': ['#0e1621', 'aegis-core-mark-dark.svg', [100, 216, 235], [140, 174, 255]], 'clair (page #F4F6FA)': ['#f4f6fa', 'aegis-core-mark.svg', [8, 122, 155], [35, 75, 206]], 'clair (carte #FFFFFF)': ['#ffffff', 'aegis-core-mark.svg', [8, 122, 155], [35, 75, 206]] }
for (const dpr of [1, 2]) {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 120 }, deviceScaleFactor: dpr })
  const p = await ctx.newPage()
  for (const [bgName, [bg, file, core, accent]] of Object.entries(bgs)) {
    const sizes = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48]
    const svg = fs.readFileSync(path.join(ASSETS, file), 'utf8')
    const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
    await p.setContent(`<body style="margin:0;background:${bg};display:flex;gap:24px;align-items:center;padding:20px">${sizes.map((s) => `<img src="${uri}" width="${s}" height="${s}">`).join('')}</body>`)
    await p.waitForTimeout(150)
    const shot = await p.screenshot()
    const rows = await p.evaluate(async ({ b64, bg, core, accent, dpr, sizes }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
      const L = (r, gg, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b) }
      const bgRGB = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
      const R = (a, b) => { const x = L(...a), y = L(...b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
      const imgs = [...document.querySelectorAll('img')]
      return imgs.map((el, i) => {
        const b = el.getBoundingClientRect(); const s = sizes[i]
        const x0 = Math.round(b.x * dpr), y0 = Math.round(b.y * dpr), w = Math.round(b.width * dpr), h = Math.round(b.height * dpr)
        // noyau : losange de (24..40, 33..49) / 64 ; son centre (32, 41)
        let coreBest = 0, corePx = 0
        const cx0 = Math.floor(x0 + w * 24 / 64), cx1 = Math.ceil(x0 + w * 40 / 64), cy0 = Math.floor(y0 + h * 33 / 64), cy1 = Math.ceil(y0 + h * 49 / 64)
        for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
          const d = g.getImageData(x, y, 1, 1).data
          const px = [d[0], d[1], d[2]]
          // pixel « cyan » : plus proche du noyau que du fond et que du corps du A
          const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
          if (dist(px, core) < dist(px, bgRGB) && dist(px, core) < dist(px, accent)) { corePx++; coreBest = Math.max(coreBest, R(px, bgRGB)) }
        }
        return { size: s, coreDiagonalCssPx: Math.round(s / 4 * 10) / 10, corePixelsRecognisable: corePx, coreBestContrast: Math.round(coreBest * 100) / 100 }
      })
    }, { b64: shot.toString('base64'), bg, core, accent, dpr, sizes })
    out.mark.push({ dpr, bg: bgName, rows })
  }
  await ctx.close()
}
console.log('\nSymbole (noyau : pixels reconnaissables comme noyau, meilleur contraste noyau / fond)')
for (const e of out.mark) console.log(` ${e.dpr}x ${e.bg}:`, e.rows.map((r) => `${r.size}px→${r.corePixelsRecognisable}px/${r.coreBestContrast}`).join('  '))
await browser.close()
fs.writeFileSync(new URL('./results-logo.json', import.meta.url), JSON.stringify(out, null, 1))
