// Independent rendered review of the Manager overview (#159) on the isolated API seeded by run.sh.
// Synthetic data only. Failures and partial pages are injected in the browser, never in the database.
// Usage: WEB_DIR=<apps/admin-web> QA_CREDS=<credentials> OUT_DIR=<dir> node overview-review.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(process.env.WEB_DIR + '/package.json')
const { chromium } = require('playwright')
const { AxeBuilder } = require('@axe-core/playwright')

const BASE = 'http://127.0.0.1:4173'
const API = 'http://127.0.0.1:18081/api/v1'
const [email, password] = fs.readFileSync(process.env.QA_CREDS, 'utf8').split('\n')[0].split(' ')
const OUT = process.env.OUT_DIR
fs.mkdirSync(OUT, { recursive: true })
const results = []
const record = (verdict, name, evidence) => { results.push({ verdict, name, evidence }); console.log(verdict.padEnd(5), name, '::', evidence) }
const check = (name, ok, evidence) => record(ok ? 'PASS' : 'FAIL', name, evidence)

const NON_TERMINAL = ['REQUESTED', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED']
const FR = { anomalies: /^Anomalies ouvertes/, loans: /^Prêts en retard/, operations: /^Opération/, reservations: /^Réservations actives/ }
const EN = { anomalies: /^Open anomalies/i, loans: /^Overdue loans/i, operations: /^Operation/i, reservations: /^Active reservations/i }

// One API sign-in: the login endpoint allows about five per minute and every browser context signs in as well.
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
const token = (await login.json()).accessToken
if (!token) throw new Error(`API sign-in refused: HTTP ${login.status}`)
const get = async (path) => (await fetch(API + path, { headers: { authorization: `Bearer ${token}` } })).json()

const truth = {
  anomalies: (await get('/admin/anomalies?status=OPEN&size=1')).totalItems,
  reservations: (await get('/admin/reservations?status=ACTIVE&size=1')).totalItems,
  operations: 0,
  overdue: 0,
}
for (const s of NON_TERMINAL) truth.operations += (await get(`/admin/locker-operations?status=${s}&size=1`)).totalItems
let loanPopulation = 0
for (const s of ['ACTIVE', 'RETURN_PENDING']) {
  const p = await get(`/admin/loans?status=${s}&size=100`)
  loanPopulation += p.totalItems
  truth.overdue += p.items.filter((l) => l.overdue === true).length
}
record('INFO', 'API truth (authoritative totalItems)', JSON.stringify({ ...truth, loanPopulation }))

const browser = await chromium.launch()
let lastLogin = Date.now()
async function open({ lang = 'fr', width = 1440, height = 900, theme = 'light', routes = [] } = {}) {
  // Stay under the sign-in rate limit (about five per minute).
  const wait = 13000 - (Date.now() - lastLogin)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastLogin = Date.now()
  const context = await browser.newContext({ viewport: { width, height }, locale: lang === 'fr' ? 'fr-CA' : 'en-CA', colorScheme: theme })
  const page = await context.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  for (const [pattern, handler] of routes) await page.route(pattern, handler)
  await page.goto(BASE + '/connexion')
  const l = lang === 'fr' ? ['Adresse courriel', 'Mot de passe', 'Se connecter'] : ['Email address', 'Password', 'Sign in']
  await page.getByLabel(l[0]).fill(email)
  await page.getByLabel(l[1], { exact: true }).fill(password)
  await page.getByRole('button', { name: l[2] }).click()
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  // The session lives in memory: move inside the SPA through the sidebar, as a person would.
  await page.waitForLoadState('networkidle')
  const nav = page.getByRole('navigation', { name: /Sections/ }).first()
  if (!(await nav.isVisible())) await page.getByRole('button', { name: /Ouvrir le menu|Open menu/ }).click()
  await page.getByRole('navigation', { name: /Sections/ }).first().getByRole('link', { name: lang === 'fr' ? "Vue d'ensemble" : 'Overview' }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  return page
}
const region = (page, name) => page.getByRole('region', { name })
// Wait until the block settles: TanStack retries a failed read before showing the error state.
async function text(page, name) {
  const r = region(page, name).first()
  await r.waitFor()
  for (let i = 0; i < 40 && (await r.getAttribute('aria-busy')) === 'true'; i++) await page.waitForTimeout(500)
  return (await r.innerText()).replace(/\s+/g, ' ')
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled' })
async function axe(page, name) {
  await page.waitForTimeout(800)
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const v = r.violations.map((x) => `${x.id}(${x.impact}) ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  check(`axe WCAG A/AA: ${name}`, v.length === 0, v.length ? v.join(' ;; ') : `0 violations, ${r.passes.length} rules passed`)
}
const has = (s, re) => re.test(s)
// A count rendered as a number followed by its unit; zero must never appear for an unread block.
const shows = (s, n, unit) => new RegExp(`(^|\\D)${n}\\s*(observée?s?\\s*)?${unit}`).test(s)

// O1 — nominal counts equal the API's authoritative totals
{
  const page = await open()
  const a = await text(page, FR.anomalies), r = await text(page, FR.reservations), o = await text(page, FR.operations), l = await text(page, FR.loans)
  check('O1.1 anomalies = OPEN totalItems', shows(a, truth.anomalies, 'ouverte') || (truth.anomalies === 0 && has(a, /Aucune anomalie ouverte/)), a.slice(0, 160))
  check('O1.2 reservations = ACTIVE totalItems', shows(r, truth.reservations, 'active') || (truth.reservations === 0 && has(r, /Aucune réservation active/)), r.slice(0, 160))
  check('O1.3 operations = sum of non-terminal totalItems', shows(o, truth.operations, 'en cours') || (truth.operations === 0 && has(o, /Aucune opération/)), o.slice(0, 160))
  const loanExact = loanPopulation <= 200
  check('O1.4 overdue = server-flagged overdue loans', loanExact && (shows(l, truth.overdue, 'en retard') || (truth.overdue === 0 && has(l, /Aucun prêt en retard/))) && !has(l, /Au moins/), l.slice(0, 160))
  const zone = await page.locator('main').innerText()
  check('O1.5 lab time zone stated', /Heures du laboratoire\s*:\s*\S+/.test(zone), (zone.match(/Heures du laboratoire[^\n]*/) || ['absent'])[0])
  check('O1.6 no script error', page.errors.length === 0, page.errors.join(' | ') || 'none')
  await shot(page, 'O1-fr-1440-light')
  await axe(page, 'overview fr 1440 light')

  // O5 — links open the existing pages with their filters
  for (const [block, link, expect] of [[FR.anomalies, 'Voir les anomalies', /\/anomalies/], [FR.reservations, 'Voir les réservations', /reserv/i], [FR.loans, 'Voir les prêts', /pr[eê]ts|loans|onglet|tab/i], [FR.operations, 'Voir les opérations', /op[eé]ration/i]]) {
    const before = page.url()
    const a2 = region(page, block).first().getByRole('link', { name: link })
    const href = (await a2.count()) ? await a2.first().getAttribute('href') : null
    check(`O5 link « ${link} »`, href !== null && expect.test(decodeURIComponent(href)), `href=${href}`)
    if (href) {
      await a2.first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(600)
      const h1 = await page.getByRole('heading', { level: 1 }).first().innerText()
      check(`O5 « ${link} » lands on a page`, page.url() !== before && !/introuvable|not found/i.test(h1), `${page.url().replace(BASE, '')} h1=${h1}`)
      await page.goBack(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(600)
    }
  }

  await page.close()
}

// O2 — anomalies endpoint 500: its block is unavailable, never zero; other blocks still show their totals
{
  const page = await open({ routes: [['**/api/v1/admin/anomalies?**', (route) => route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ status: 500, title: 'Internal Server Error', traceId: 'qa-o2' }) })]] })
  const a = await text(page, FR.anomalies), r = await text(page, FR.reservations)
  check('O2.1 anomalies 500 is not a zero count', !shows(a, 0, 'ouverte') && !has(a, /Aucune anomalie ouverte/), a.slice(0, 200))
  check('O2.2 other blocks unaffected by the anomalies failure', shows(r, truth.reservations, 'active') || (truth.reservations === 0 && has(r, /Aucune réservation/)), r.slice(0, 120))
  await shot(page, 'O2-anomalies-500')
  await axe(page, 'overview with a failed block')
  await page.close()
}

// O3 — loans time out: no zero, no « none overdue »; other blocks unaffected
{
  const page = await open({ routes: [['**/api/v1/admin/loans?**', (route) => route.abort('timedout')]] })
  const l = await text(page, FR.loans), a = await text(page, FR.anomalies)
  check('O3.1 loans timeout is not a zero or an empty list', !shows(l, 0, 'en retard') && !has(l, /Aucun prêt en retard|Aucun retard/), l.slice(0, 200))
  check('O3.2 anomalies unaffected by the loans timeout', shows(a, truth.anomalies, 'ouverte') || (truth.anomalies === 0 && has(a, /Aucune anomalie/)), a.slice(0, 120))
  await shot(page, 'O3-loans-timeout')
  await page.close()
}

// O4 — partial reads are qualified, never counted as the population
{
  const inflate = (extra) => async (route) => {
    const res = await route.fetch(); const body = await res.json()
    body.totalItems = body.items.length + extra; body.totalPages = 2
    await route.fulfill({ response: res, body: JSON.stringify(body) })
  }
  const page = await open({ routes: [
    ['**/api/v1/admin/loans?status=ACTIVE**', inflate(250)],
    ['**/api/v1/admin/locker-operations?status=DOOR_OPENED**', (route) => route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"status":503}' })],
  ] })
  const l = await text(page, FR.loans), o = await text(page, FR.operations)
  check('O4.1 truncated loans read is qualified as among the loans read', has(l, /\d+ en retard parmi les prêts lus/) && has(l, /Lecture incomplète/) && !has(l, /Au moins/), l.slice(0, 260))
  check('O4.2 one unread operation status is qualified as among the operations read', has(o, /\d+ en cours parmi les opérations lues/) && has(o, /ne porte que sur les opérations lues/) && !has(o, /Au moins/), o.slice(0, 260))
  await shot(page, 'O4-partial')
  await page.close()
}
{
  const page = await open({ routes: [['**/api/v1/admin/reservations?status=ACTIVE**', async (route) => {
    const res = await route.fetch(); const body = await res.json(); body.totalItems = 37; body.totalPages = 8
    await route.fulfill({ response: res, body: JSON.stringify(body) })
  }]] })
  const r = await text(page, FR.reservations)
  check('O4.3 reservation count is totalItems, not the preview length', shows(r, 37, 'active'), r.slice(0, 200))
  await page.close()
}

// O9 — non-atomic reads (#170 coordinator finding 6805612104). The operation c01 moves from one status to the next
// between two status reads: both responses then hold it with totalItems = 1. The block must not claim an exact 2.
{
  const C01 = '5eed0000-0000-4000-8000-000000000c01'
  const page = await open({ routes: [['**/api/v1/admin/locker-operations?status=COMMAND_ACKNOWLEDGED**', async (route) => {
    const res = await route.fetch()
    const live = await get('/admin/locker-operations?status=AWAITING_LOCAL_PROOF&size=5')
    const op = live.items.find((o) => o.id === C01)
    const body = { items: op ? [{ ...op, status: 'COMMAND_ACKNOWLEDGED' }] : [], page: 0, size: 5, totalItems: op ? 1 : 0, totalPages: op ? 1 : 0 }
    await route.fulfill({ response: res, body: JSON.stringify(body) })
  }]] })
  const o = await text(page, FR.operations)
  check('O9.1 one operation seen in two status reads counts once, as observed', shows(o, 1, 'en cours') && /observée en cours/.test(o) && !shows(o, 2, 'en cours'), o.slice(0, 220))
  check('O9.2 successive-reads note shown', /pas au même instant/.test(await page.locator('main').innerText()), 'successiveReadsNote')
  await shot(page, 'O9-operation-two-statuses')
  await page.close()
}
// O10 — the same overdue loan returned by both open-status reads is counted once (row deduplication).
{
  const page = await open({ routes: [['**/api/v1/admin/loans?status=RETURN_PENDING**', async (route) => {
    const res = await route.fetch()
    const active = await get('/admin/loans?status=ACTIVE&size=100')
    const dup = active.items.filter((l) => l.overdue === true).map((l) => ({ ...l, status: 'RETURN_PENDING' }))
    await route.fulfill({ response: res, body: JSON.stringify({ items: dup, page: 0, size: 100, totalItems: dup.length, totalPages: dup.length ? 1 : 0 }) })
  }]] })
  const l = await text(page, FR.loans)
  check('O10.1 an overdue loan present in both open-status reads is counted once', shows(l, truth.overdue, 'en retard') && !shows(l, truth.overdue * 2, 'en retard'), l.slice(0, 220))
  await page.close()
}

// O6 — English, narrow and dark
{
  const page = await open({ lang: 'en' })
  const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  check('O6.1 English rendering', /Overview/i.test(main) && !/Anomalies ouvertes|Réservations actives/.test(main), main.slice(0, 160))
  await axe(page, 'overview en 1440')
  await page.close()
}
for (const [theme, width] of [['dark', 1440], ['light', 390], ['dark', 390]]) {
  const page = await open({ theme, width, height: 844 })
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  check(`O7 no horizontal scroll ${theme} ${width}`, sw <= cw, `scrollWidth ${sw} clientWidth ${cw}`)
  await shot(page, `O7-${theme}-${width}`)
  await axe(page, `overview fr ${width} ${theme}`)
  await page.close()
}

// O8 — keyboard: Tab reaches every « Voir … » link with a visible focus indicator
{
  const page = await open()
  const reached = new Set()
  let outlineOk = true
  for (let i = 0; i < 80 && reached.size < 4; i++) {
    await page.keyboard.press('Tab')
    const f = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { t: (e.innerText || '').trim(), o: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none' } })
    if (/^Voir les (anomalies|prêts|opérations|réservations)/.test(f.t)) { reached.add(f.t); if (!f.o) outlineOk = false }
  }
  check('O8 Tab reaches the four block links with visible focus', reached.size === 4 && outlineOk, [...reached].join(' | ') + ` outline=${outlineOk}`)
  await page.close()
}

await browser.close()
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
const n = (v) => results.filter((r) => r.verdict === v).length
console.log(`overview: ${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('INFO')} INFO`)
process.exitCode = n('FAIL') ? 1 : 0
