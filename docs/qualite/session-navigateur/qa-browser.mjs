// Independent QA browser checks of #178 against the REAL Aegis Control API (no mocked API responses), Chromium.
// Some cases inject a fault on one route (abort, 5xx, 403) with page.route: they are labelled "fault-injected".
// Usage: node qa-browser.mjs <phase> ; env QA_BASE, QA_ADMIN_PW, QA_WEB_DIR, QA_SQL (shell prefix running psql -c),
// QA_STATE (storage-state file). Passwords and cookie values are never printed.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const require = createRequire(`${process.env.QA_WEB_DIR}/package.json`)
const { chromium } = require('playwright')

const BASE = process.env.QA_BASE
const ADMIN = 'admin@aegis.demo'
const PW = process.env.QA_ADMIN_PW
const COOKIE = '__Secure-aegis_session'
let failures = 0
const pass = (m) => console.log(`PASS ${m}`)
const fail = (m) => { console.log(`FAIL ${m}`); failures++ }
const obs = (m) => console.log(`OBS  ${m}`)
const check = (ok, m, detail = '') => (ok ? pass(m) : fail(`${m}${detail ? ` (${detail})` : ''}`))
const sql = (q) => execFileSync('bash', ['-c', `${process.env.QA_SQL} "$1"`, '_', q]).toString().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function track(page) {
  const calls = []
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push({ m: r.method(), p: u.pathname, r }) })
  return calls
}
const count = (calls, path) => calls.filter((c) => c.p === path).length
const REFRESH = '/api/v1/auth/session/refresh'
const REVOKE = '/api/v1/auth/session/revoke'

async function signIn(page, password = PW) {
  await page.goto(`${BASE}/connexion`)
  await page.getByLabel('Adresse courriel').fill(ADMIN)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/connexion'), { timeout: 20000 })
}
const onSignIn = (page) => new URL(page.url()).pathname === '/connexion'
const cookieOf = async (ctx) => (await ctx.cookies()).find((c) => c.name === COOKIE)
async function openAccountMenu(page) { await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Administrateur/ }).click() }
async function heading(page, name) { return page.getByRole('heading', { level: 1, name }).isVisible().catch(() => false) }

async function phase1(browser) {
  // W1 reload on a deep link, one refresh at boot; W2 nothing in storage; W13 cookie only on session routes
  { const ctx = await browser.newContext({ locale: 'fr-CA' }); const page = await ctx.newPage(); const calls = track(page)
    await signIn(page)
    let token = null
    page.on('response', async (r) => { if (new URL(r.url()).pathname === REFRESH && r.status() === 200) token = (await r.json()).accessToken })
    await page.goto(`${BASE}/audit?type=PASSWORD_CHANGED`); await page.waitForLoadState('networkidle')
    const before = count(calls, REFRESH)
    await page.reload(); await page.waitForLoadState('networkidle'); await sleep(1500)
    const url = new URL(page.url())
    check(url.pathname === '/audit' && count(calls, REFRESH) - before === 1 && await heading(page, /Audit|Journal/),
      'W1 reload on a deep link (/audit?type=…) restores in place with exactly one refresh', `${url.pathname}${url.search}, refreshes ${count(calls, REFRESH) - before}`)
    check(url.search.includes('type=PASSWORD_CHANGED'), 'W1b the query string of the deep link survives the reload', url.search)
    const st = await page.evaluate(async () => ({ l: Object.keys(localStorage).length, s: Object.keys(sessionStorage).length, c: document.cookie,
      idb: (await (indexedDB.databases?.() ?? Promise.resolve([]))).length, html: document.documentElement.outerHTML }))
    check(st.l === 0 && st.s === 0 && st.c === '' && st.idb === 0 && token && !st.html.includes(token),
      'W2 token only in memory: no localStorage, sessionStorage, IndexedDB, readable cookie, nor token in the DOM', `l=${st.l} s=${st.s} cookie=${st.c ? 'set' : ''} idb=${st.idb} tokenSeen=${!!token}`)
    const c = await cookieOf(ctx)
    check(c && c.httpOnly && c.secure && c.sameSite === 'Strict' && c.path === '/api/v1/auth/session', 'W2b cookie HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth/session')
    let leaks = 0, sess = 0
    for (const call of calls) { let h = {}; try { h = await call.r.allHeaders() } catch { continue }
      const has = (h.cookie ?? '').includes(COOKIE); if (call.p.startsWith('/api/v1/auth/session')) sess += has ? 1 : 0; else leaks += has ? 1 : 0 }
    check(leaks === 0 && sess > 0, 'W13 the cookie travels only to /auth/session/* routes', `leaks ${leaks}, session calls with cookie ${sess}`)
    // W3 server-side revocation, then reload: once to sign-in with the return path, no refresh loop
    sql(`UPDATE aegis.browser_sessions SET revoked_at = now(), revocation_reason = 'SIGNED_OUT' WHERE revoked_at IS NULL`)
    const b3 = count(calls, REFRESH)
    await page.goto(`${BASE}/casiers`); await sleep(5000)
    const u3 = new URL(page.url())
    check(u3.pathname === '/connexion' && u3.searchParams.get('retour') === '/casiers' && count(calls, REFRESH) - b3 === 1,
      'W3 revoked server-side: one refresh, 401, then sign-in with retour=/casiers and no loop over 5 s', `${u3.pathname}${u3.search}, refreshes ${count(calls, REFRESH) - b3}`)
    check(!(await cookieOf(ctx)), 'W3b the 401 cleared the cookie in the browser')
    await ctx.close() }

  // W5 account disabled while signed in: the next API call gets 401; one trip to sign-in, no loop
  { const ctx = await browser.newContext({ locale: 'fr-CA' }); const page = await ctx.newPage(); const calls = track(page)
    await signIn(page)
    sql(`UPDATE aegis.users SET status='DISABLED' WHERE email='${ADMIN}'`)
    try { await page.goto(`${BASE}/anomalies`); await sleep(5000)
      const u = new URL(page.url())
      check(u.pathname === '/connexion' && count(calls, REFRESH) <= 2, 'W5 disabled account: back to sign-in once, no refresh loop', `${u.pathname}, refreshes ${count(calls, REFRESH)}`)
      const r = sql(`SELECT string_agg(DISTINCT coalesce(revocation_reason,'open'), ',') FROM aegis.browser_sessions WHERE created_at > now() - interval '2 minutes'`)
      check(r.includes('ACCOUNT_CHANGED'), 'W5b its browser session is revoked ACCOUNT_CHANGED', r)
    } finally { sql(`UPDATE aegis.users SET status='ACTIVE' WHERE email='${ADMIN}'`) }
    await ctx.close() }

  // W6/W7 fault-injected: network failure and 503 on the restore keep the session and offer Retry
  for (const [id, fault] of [['W6', 'abort'], ['W7', 503]]) {
    const ctx = await browser.newContext({ locale: 'fr-CA' }); const page = await ctx.newPage(); const calls = track(page)
    await signIn(page)
    await page.route(`**${REFRESH}`, (route) => (fault === 'abort' ? route.abort('connectionrefused') : route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"code":"SERVICE_UNAVAILABLE"}' })))
    await page.goto(`${BASE}/casiers`); await sleep(3000)
    const retry = page.getByRole('button', { name: 'Réessayer' })
    const stay = new URL(page.url()).pathname === '/casiers'
    const hasRetry = await retry.first().isVisible().catch(() => false)
    check(stay && hasRetry && !!(await cookieOf(ctx)) && count(calls, REVOKE) === 0,
      `${id} fault-injected ${fault} on restore: stays on /casiers, Retry shown, cookie kept, no revoke`, `path ${new URL(page.url()).pathname}, retry ${hasRetry}, revokes ${count(calls, REVOKE)}`)
    await page.unroute(`**${REFRESH}`)
    await retry.first().click().catch(() => {}); await sleep(2500)
    check(await heading(page, 'Casiers'), `${id}b after the fault clears, Retry restores the session in place`)
    await ctx.close()
  }

  // W8 fault-injected 403 on a data read: no sign-out
  { const ctx = await browser.newContext({ locale: 'fr-CA' }); const page = await ctx.newPage(); const calls = track(page)
    await signIn(page)
    await page.route('**/api/v1/admin/**', (route) => route.fulfill({ status: 403, contentType: 'application/problem+json', body: '{"code":"FORBIDDEN"}' }))
    await page.goto(`${BASE}/anomalies`).catch(() => {}); await sleep(3000)
    await page.unroute('**/api/v1/admin/**')
    const p = new URL(page.url()).pathname
    check(p === '/anomalies' && count(calls, REVOKE) === 0 && !!(await cookieOf(ctx)), 'W8 fault-injected 403 on admin reads: no sign-out, no revoke, cookie kept', `path ${p}, revokes ${count(calls, REVOKE)}`)
    // W9 sign-out not confirmed, then confirmed
    await page.route(`**${REVOKE}`, (route) => route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"code":"INTERNAL_ERROR"}' }))
    await openAccountMenu(page); await page.getByRole('button', { name: 'Se déconnecter' }).first().click(); await sleep(2000)
    const msg = await page.getByText('Impossible de confirmer la déconnexion. Réessayez.').first().isVisible().catch(() => false)
    check(msg && new URL(page.url()).pathname !== '/connexion' && !!(await cookieOf(ctx)), 'W9 fault-injected 500 on revoke: exact message, still signed in, cookie kept')
    await page.unroute(`**${REVOKE}`)
    await page.reload(); await sleep(2500)
    check(new URL(page.url()).pathname === '/anomalies', 'W9b after the failed sign-out a reload still restores the session (nothing pretended)')
    const page2 = await ctx.newPage(); await page2.goto(`${BASE}/casiers`); await sleep(2500)
    check(await heading(page2, 'Casiers'), 'W10a a second tab of the same browser restores the same session')
    await openAccountMenu(page); await page.getByRole('button', { name: 'Se déconnecter' }).first().click(); await sleep(3000)
    const p1 = new URL(page.url()).pathname, p2 = new URL(page2.url()).pathname
    check(p1 === '/connexion' && !(await cookieOf(ctx)), 'W9c confirmed sign-out: sign-in page and cookie cleared', p1)
    check(p2 === '/connexion', 'W10 the other tab leaves the protected page without a reload', p2)
    await page.reload(); await sleep(2000)
    check(new URL(page.url()).pathname === '/connexion', 'W9d reload after the sign-out stays on sign-in')
    await ctx.close() }
}

async function phase2a(browser) { // a browser session that a password rotation must end
  const ctx = await browser.newContext({ locale: 'fr-CA' }); const page = await ctx.newPage()
  await signIn(page); await page.goto(`${BASE}/casiers`); await sleep(1500)
  await ctx.storageState({ path: process.env.QA_STATE }); await ctx.close()
}

async function phase2b(browser) { // after the API restarted with a new demo password
  const ctx = await browser.newContext({ locale: 'fr-CA', storageState: process.env.QA_STATE }); const page = await ctx.newPage(); const calls = track(page)
  await page.goto(`${BASE}/casiers`); await sleep(4000)
  const u = new URL(page.url())
  check(u.pathname === '/connexion' && count(calls, REFRESH) === 1, 'W4 after a real password rotation the old browser session cannot restore: one refresh, sign-in', `${u.pathname}, refreshes ${count(calls, REFRESH)}`)
  await signIn(page, process.env.QA_ADMIN_PW2)
  await page.goto(`${BASE}/audit`); await sleep(3000)
  const label = await page.getByText('Mot de passe changé').first().isVisible().catch(() => false)
  if (label) pass('W14 the audit view shows « Mot de passe changé » for the rotation')
  else {
    await page.goto(`${BASE}/audit?type=PASSWORD_CHANGED`); await sleep(2500)
    const l2 = await page.getByText('Mot de passe changé').first().isVisible().catch(() => false)
    check(l2, 'W14 the audit view shows « Mot de passe changé » (filtered)', 'label not visible')
  }
  const detail = await page.getByText('Sessions navigateur révoquées').first().isVisible().catch(() => false)
  detail ? pass('W14b the revokedBrowserSessions detail is labelled') : obs('W14b « Sessions navigateur révoquées » not visible without opening the event')
  await ctx.close()
}

async function fallback(browser) { // W10c: without BroadcastChannel, the localStorage signal carries the sign-out to the other tab
  const ctx = await browser.newContext({ locale: 'fr-CA' })
  await ctx.addInitScript(() => { delete window.BroadcastChannel })
  const page = await ctx.newPage()
  await signIn(page, process.env.QA_ADMIN_PW2)
  await page.goto(`${BASE}/anomalies`); await sleep(2000)
  const page2 = await ctx.newPage(); await page2.goto(`${BASE}/casiers`); await sleep(2500)
  const noChannel = await page.evaluate(() => typeof window.BroadcastChannel === 'undefined')
  const seen = []
  await page2.exposeFunction('qaSeen', (v) => seen.push(v))
  await page2.evaluate(() => window.addEventListener('storage', (e) => window.qaSeen(e.newValue)))
  await openAccountMenu(page); await page.getByRole('button', { name: 'Se déconnecter' }).first().click(); await sleep(3000)
  const p2 = new URL(page2.url()).pathname
  const values = seen.filter((v) => v !== null)
  const shape = values.length > 0 && values.every((v) => /^[A-Za-z]+:[0-9a-z]+$/.test(v))
  check(noChannel && p2 === '/connexion', 'W10c without BroadcastChannel the storage fallback sends the other tab to sign-in', `noChannel ${noChannel}, other tab ${p2}`)
  check(shape, 'W10d the fallback signal is only "<signal>:<nonce>" (no token, no account data)', `${values.length} values`)
  const left = await page.evaluate(() => Object.keys(localStorage).length)
  check(left === 0, 'W10e the signal key is removed immediately (localStorage empty)', `${left} keys`)
  await ctx.close()
}

const browser = await chromium.launch()
try { await { phase1, phase2a, phase2b, fallback }[process.argv[2]](browser) } finally { await browser.close() }
console.log(`browser failures: ${failures}`); process.exit(failures)
