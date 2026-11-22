// Manager freshness probe (#197, #202); started by fraicheur-manager.sh, which documents it. Never prints a password
// or a token: they come from the environment and stay in memory.
const { chromium } = require('playwright')
const BASE = 'http://localhost:5291', API = process.env.API, LABEL = process.env.LABEL
const out = []
const log = (s) => { out.push(s); console.log(s) }
async function rest(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let j = null; try { j = JSON.parse(text) } catch {}
  return { status: r.status, j }
}
;(async () => {
  const tech = (await rest('POST', '/auth/login', null, { email: 'technician@aegis.demo', password: process.env.TECH })).j.accessToken
  const adminTok = (await rest('POST', '/auth/login', null, { email: 'admin@aegis.demo', password: process.env.ADMIN })).j.accessToken
  const assetId = (await rest('GET', '/assets?q=AEG-DEMO-001&page=0&size=10', tech)).j.items.find((a) => a.assetCode === 'AEG-DEMO-001').id
  const apiStatus = async () => (await rest('GET', `/admin/assets/${assetId}`, adminTok)).j
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ locale: 'fr-CA', viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const calls = []
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1/') && r.request().method() === 'GET') calls.push(u.pathname) })
  for (let i = 0; i < 3; i++) {
    await page.goto(BASE + '/connexion')
    await page.locator('input[name="email"]').fill('admin@aegis.demo')
    await page.locator('input[name="password"]').fill(process.env.ADMIN)
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'))
    await page.locator('form button[type="submit"]').click()
    const r = await resp; if (r.status() === 200) break
    await page.waitForTimeout((Number(r.headers()['retry-after'] ?? '60') + 1) * 1000)
  }
  await page.waitForURL(/\/equipements$/); await page.waitForLoadState('networkidle')
  const row = () => page.locator('main').locator('tr, li, [role="row"]', { hasText: 'AEG-DEMO-001' }).first()
  const rowText = async () => (await row().innerText()).replace(/\s+/g, ' ').trim()
  const listReads = (from) => calls.slice(from).filter((p) => p === '/api/v1/admin/assets').length
  const nav = async (path) => { const menu = page.locator('button[aria-haspopup="dialog"]'); if (await menu.isVisible()) await menu.click(); await page.locator(`a[href="${path}"]:visible`).click(); await page.waitForURL(new RegExp(path + '(\\?|$)')); await page.waitForLoadState('networkidle') }
  let fails = 0
  const check = (ok, s) => { log(`${ok ? 'PASS' : 'FAIL'} [${LABEL}] ${s}`); if (!ok) fails++ }
  const before = await rowText()
  log(`row before: '${before}'  api availability: ${JSON.stringify((await apiStatus()).availability)}`)
  // F1: technician reserves; Manager leaves Équipements and comes back after 6 s.
  const res = await rest('POST', '/reservations', tech, { assetId, reservedUntil: new Date(Date.now() + 30 * 60e3).toISOString().replace(/\.\d+Z$/, 'Z') })
  log(`reservation ${res.status} ${res.j?.code ?? ''}`)
  await nav('/vue-d-ensemble'); await page.waitForTimeout(6000)
  let mark = calls.length; await nav('/equipements'); await page.waitForTimeout(1500)
  const afterReserve = await rowText(); const a1 = await apiStatus()
  check(listReads(mark) >= 1, `F1 re-entering Équipements 6 s after a reservation re-reads the list (${listReads(mark)} GET /admin/assets)`)
  check(afterReserve !== before, `F1 the row changed after the reservation: '${afterReserve}' (API availability ${JSON.stringify(a1.availability)})`)
  // F2: technician cancels; Manager switches to another tab and back after 6 s (no navigation).
  const cancel = await rest('POST', `/reservations/${res.j.id}/cancel`, tech)
  log(`cancel ${cancel.status}`)
  const other = await ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForTimeout(6000)
  mark = calls.length
  const vis = () => page.evaluate(() => document.visibilityState)
  log(`visibility while the other tab is in front: ${await vis()}`)
  await page.bringToFront(); await page.waitForTimeout(500)
  log(`visibility after bringToFront: ${await vis()}; reads so far ${listReads(mark)}`)
  await other.close(); await page.waitForTimeout(500)
  log(`reads after closing the other tab: ${listReads(mark)}; visibility ${await vis()}`)
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); window.dispatchEvent(new Event('focus')) })
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500)
  log(`reads after a bubbling visibilitychange (as a real tab return) on a visible page: ${listReads(mark)}`)
  const afterCancel = await rowText(); const a2 = await apiStatus()
  check(listReads(mark) >= 1, `F2 returning to the tab 6 s after a cancellation re-reads the list (${listReads(mark)} GET /admin/assets)`)
  check(afterCancel === before, `F2 the row is back to its first state: '${afterCancel}' (API availability ${JSON.stringify(a2.availability)})`)
  await page.screenshot({ path: `${process.env.OUT}/equipements-${LABEL}.png` })
  await browser.close()
  process.exit(fails)
})().catch((e) => { console.log(`FAIL [${LABEL}] probe error ${e.message.split('\n')[0]}`); process.exit(9) })
