// Targeted review of Web bb9a252 on the seeded isolated API. Records verdicts, screenshots and axe results.
// Synthetic data only: anomalies b10 (op 607), b11 (no operation), b12 (409 race) were inserted for this review.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(process.env.WEB_DIR + '/package.json')
const { chromium } = require('playwright')
const { AxeBuilder } = require('@axe-core/playwright')

const BASE = 'http://127.0.0.1:4173'
const API = 'http://127.0.0.1:18081/api/v1'
const [email, password] = fs.readFileSync(process.env.QA_CREDS, 'utf8').split('\n')[0].split(' ')
const OUT = process.env.OUT_DIR
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const syn = (s) => `5eed0000-0000-4000-8000-${s.padStart(12, '0')}`
const results = []
const record = (verdict, name, evidence) => { results.push({ verdict, name, evidence }); console.log(verdict.padEnd(5), name, '::', evidence) }
const check = (name, ok, evidence) => record(ok ? 'PASS' : 'FAIL', name, evidence)

const LABELS = {
  fr: { email: 'Adresse courriel', password: 'Mot de passe', button: 'Se connecter' },
  en: { email: 'Email address', password: 'Password', button: 'Sign in' },
}
const browser = await chromium.launch()

async function open({ lang = 'fr', width = 1440, height = 900, theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: lang === 'fr' ? 'fr-CA' : 'en-CA', colorScheme: theme })
  const page = await context.newPage()
  page.apiLog = []
  page.errors = []
  page.on('response', (r) => { if (r.url().includes('/api/v1/')) page.apiLog.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`) })
  page.on('pageerror', (e) => page.errors.push(e.message))
  // Chromium logs every 4xx response as a console error; those are expected here, only script errors count.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) page.errors.push(`console: ${m.text()}`) })
  return page
}

async function signIn(page, lang = 'fr') {
  const l = LABELS[lang]
  if (!page.url().includes('/connexion')) await page.goto(BASE + '/connexion')
  await page.getByLabel(l.email).fill(email)
  await page.getByLabel(l.password, { exact: true }).fill(password)
  await page.getByRole('button', { name: l.button }).click()
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  await page.waitForLoadState('networkidle')
}

async function nav(page, name) {
  const sidebar = page.getByRole('navigation', { name: /Sections/ })
  if (!(await sidebar.isVisible())) await page.getByRole('button', { name: /Ouvrir le menu|Open menu/ }).click()
  await page.getByRole('navigation', { name: /Sections/ }).getByRole('link', { name }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
}

async function axe(page, name) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const v = r.violations.map((x) => `${x.id}(${x.impact}) ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  check(`axe WCAG A/AA: ${name}`, v.length === 0, v.length ? v.join(' ;; ') : `0 violations, ${r.passes.length} rules passed`)
}

async function noHScroll(page, name) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  check(`no horizontal scroll: ${name}`, sw <= cw, `scrollWidth ${sw} clientWidth ${cw}`)
}

// The session lives in memory: a full navigation signs out. Move inside the SPA instead, like a link would.
async function spaGo(page, path) {
  await page.evaluate((p) => { history.pushState(null, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled' })
const main = (page) => page.locator('main').innerText()
// One API sign-in per run: the login endpoint is rate limited (about five per minute) and the UI signs in too.
let cachedToken
async function adminToken() {
  if (cachedToken) return cachedToken
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  cachedToken = (await r.json()).accessToken
  if (!cachedToken) throw new Error(`API sign-in refused: HTTP ${r.status}`)
  return cachedToken
}

const scenarios = {
  async anomalies() {
    const page = await open()
    await signIn(page)
    await nav(page, 'Anomalies')
    const text = await main(page)
    check('A1 OPEN list shows the three synthetic OPEN anomalies', /3 anomalies/.test(text), text.match(/\d+ anomalies?/g)?.join(', '))
    await shot(page, 'anomalies-list-fr-1440')
    await axe(page, '/anomalies list (fr, 1440)')

    // b11: no operation. Its dossier must state the missing correlation, never invent one.
    await page.goto(`${BASE}/anomalies?anomalie=${syn('b11')}`)
    if (page.url().includes('/connexion')) record('INFO', 'A2 direct URL to a dossier after reload goes to sign-in (memory-only session)', page.url())
    await signIn(page)
    await page.waitForTimeout(600)
    record('INFO', 'A2 URL after sign-in from a dossier link', page.url().replace(BASE, ''))
    if (!page.url().includes(syn('b11'))) await spaGo(page, `/anomalies?anomalie=${syn('b11')}`)
    const dossier = page.locator('.ag-dossier')
    await dossier.waitFor()
    const d11 = await dossier.innerText()
    check('A3 b11 dossier shows the missing operation as missing', /aucune opération|sans opération|non corrél|aucune|non disponible/i.test(d11) && !/5eed0000-0000-4000-8000-0000000006/.test(d11), d11.replace(/\s+/g, ' ').slice(0, 400))
    check('A3 no raw marker or secret in the dossier', !/QA-RAW-SENTINEL|QA-SECRET-SENTINEL|E2005EED/.test(d11), 'searched dossier text')
    await shot(page, 'anomalies-b11-missing-correlation-fr-1440')
    await axe(page, '/anomalies dossier b11 (fr, 1440)')

    // Acknowledge b10 through the UI: success, ACKNOWLEDGED, not resolved.
    await spaGo(page, `/anomalies?anomalie=${syn('b10')}`)
    await dossier.waitFor()
    const d10 = await dossier.innerText()
    record('INFO', 'A4 b10 dossier (operation 607 FAILED)', d10.replace(/\s+/g, ' ').slice(0, 400))
    // W2: times are shown in the laboratory zone, never in UTC.
    const b10 = await (await fetch(`${API}/admin/anomalies/${syn('b10')}`, { headers: { authorization: `Bearer ${await adminToken()}` } })).json()
    const hm = (zone) => new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(b10.detectedAt ?? b10.createdAt))
    check('A7 (W2) the dossier time is America/Toronto, not UTC',
      d10.includes(hm('America/Toronto')) && !d10.includes(hm('UTC')), `Toronto ${hm('America/Toronto')}, UTC ${hm('UTC')}`)
    await page.getByRole('button', { name: /Reconnaître/ }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    const focused = await page.evaluate(() => document.activeElement?.tagName + ' ' + (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id))
    record('INFO', 'A4 focus when the dialog opens', focused)
    await page.waitForTimeout(1500) // axe during the fade-in reports false contrast failures
    await axe(page, 'acknowledge dialog (fr, 1440)')
    await dialog.getByRole('button', { name: /Reconnaître/ }).click()
    await page.waitForTimeout(300)
    record('INFO', 'A4 empty note submit', (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 300))
    await dialog.getByRole('textbox').fill('Revue QA synthétique : commande rejetée examinée (b10).')
    await dialog.getByRole('button', { name: /Reconnaître/ }).click()
    await page.waitForTimeout(1500)
    const after = await dossier.innerText()
    const ackCalls = page.apiLog.filter((l) => l.includes('/acknowledge'))
    check('A4 UI acknowledgement: one POST 200, dossier shows Reconnue, never Résolue', ackCalls.length === 1 && ackCalls[0].startsWith('200') && /Reconnue/.test(after) && !/Résolue le/.test(after), `${ackCalls.join(' ')} | ${after.replace(/\s+/g, ' ').slice(0, 300)}`)
    const back = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 60))
    record('INFO', 'A4 focus after the dialog closes', back)
    await shot(page, 'anomalies-b10-acknowledged-fr-1440')

    // 409: open the dialog on b12, acknowledge it elsewhere, then submit.
    await spaGo(page, `/anomalies?anomalie=${syn('b12')}`)
    await dossier.waitFor()
    await page.getByRole('button', { name: /Reconnaître/ }).first().click()
    await dialog.waitFor()
    const note = 'Note QA saisie avant la reconnaissance concurrente (b12).'
    await dialog.getByRole('textbox').fill(note)
    const token = await adminToken()
    const other = await fetch(`${API}/admin/anomalies/${syn('b12')}/acknowledge`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ note: 'Reconnaissance concurrente synthétique (QA).' }),
    })
    record('INFO', 'A5 concurrent acknowledgement by another admin client', `HTTP ${other.status}`)
    await dialog.getByRole('button', { name: /Reconnaître/ }).click()
    await page.waitForTimeout(1500)
    const conflict = await page.locator('body').innerText()
    const ro = await page.evaluate((n) => [...document.querySelectorAll('textarea')].map((t) => ({ v: t.value === n, ro: t.readOnly || t.disabled })), note)
    check('A5 409: the request was answered 409', page.apiLog.some((l) => l.startsWith('409') && l.includes(syn('b12'))), page.apiLog.filter((l) => l.includes('b12')).join(' | '))
    check('A5 409: the typed note is kept read-only', ro.some((x) => x.v && x.ro), JSON.stringify(ro))
    check('A5 409: the server state (Reconnue) is shown', /Reconnue/.test(conflict), conflict.replace(/\s+/g, ' ').match(/.{0,120}(déjà|conflit|Reconnue).{0,160}/i)?.[0] ?? '')
    await shot(page, 'anomalies-b12-conflict-409-fr-1440')
    await axe(page, 'acknowledge 409 state (fr, 1440)')
    check('A6 no page error on /anomalies', page.errors.length === 0, page.errors.join(' | ') || 'none')
    await page.context().close()
  },

  async transactions() {
    const page = await open()
    await signIn(page)
    await nav(page, 'Réservations et prêts')
    await axe(page, '/reservations-prets reservations (fr, 1440)')
    // W1: select a reservation, then switch: nothing of the reservation view is counted, listed or fetched as a loan.
    await spaGo(page, `/reservations-prets?dossier=${syn('509')}`)
    await page.waitForTimeout(800)
    await page.getByRole('main').getByText('Prêts', { exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    const loans = await main(page)
    const token = await adminToken()
    const loanTotal = (await (await fetch(`${API}/admin/loans?size=1`, { headers: { authorization: `Bearer ${token}` } })).json()).totalItems
    const shownCount = loans.match(/(\d+) prêts?/)?.[1]
    check('T6 (W1) after the switch the count is the loan total and no reservation is fetched as a loan',
      String(loanTotal) === shownCount && !page.apiLog.some((l) => l.startsWith('404') && l.includes('/admin/loans/'))
        && !/SYN-ANOM-TARGET/.test(loans) && !/19 h 00 HNE/.test(loans),
      `shown ${shownCount}, API total ${loanTotal}, loan 404s ${page.apiLog.filter((l) => l.startsWith('404')).length}`)
    record('INFO', 'T1 loans tab text', loans.replace(/\s+/g, ' ').slice(0, 900))
    check('T1 URL carries the tab (?vue=prets)', /vue=prets/.test(page.url()), page.url().replace(BASE, ''))
    await shot(page, 'transactions-loans-fr-1440')
    await axe(page, '/reservations-prets loans (fr, 1440)')
    // The overdue loan 702 must read as borrowed and late, never as returned or available.
    await spaGo(page, `/reservations-prets?vue=prets&dossier=${syn('702')}`)
    await page.waitForTimeout(800)
    const t702 = await main(page)
    const dossierText = t702.replace(/\s+/g, ' ')
    check('T2 loan 702 reads as late and still borrowed (Actif + retard), not available or returned',
      /retard/i.test(dossierText) && /Actif|en cours|emprunt/i.test(dossierText) && !/Disponible|Retourné|Terminé/.test(dossierText.slice(dossierText.indexOf('SYN-LOAN-OVERDUE'))),
      dossierText.slice(Math.max(0, dossierText.indexOf('SYN-LOAN-OVERDUE') - 100), dossierText.indexOf('SYN-LOAN-OVERDUE') + 500))
    await shot(page, 'transactions-loan-702-overdue-fr-1440')
    check('T2 no end-loan / force-return / confirm action button', !(await page.getByRole('button', { name: /Terminer|Forcer|Confirmer|Retour forcé/ }).count()), (await page.getByRole('button').allInnerTexts()).filter(Boolean).join(', '))
    await page.getByRole('main').getByText('Opérations physiques', { exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    await axe(page, '/reservations-prets operations (fr, 1440)')
    await shot(page, 'transactions-operations-fr-1440')
    // Back/forward between tabs.
    await page.goBack(); await page.waitForTimeout(400)
    const backUrl = page.url().replace(BASE, '')
    await page.goForward(); await page.waitForTimeout(400)
    check('T3 back/forward follow the tabs', /vue=prets/.test(backUrl) && /vue=operations/.test(page.url()), `${backUrl} -> ${page.url().replace(BASE, '')}`)
    // Reservation 509: currentOperationId is the FAILED attempt 609.
    await spaGo(page, `/reservations-prets?dossier=${syn('509')}`)
    await page.waitForTimeout(800)
    const r509 = (await main(page)).replace(/\s+/g, ' ')
    record('INFO', 'T4 reservation 509 dossier (ACTIVE, attempt 609 FAILED)', r509.slice(Math.max(0, r509.indexOf('SYN-ANOM-TARGET')), r509.indexOf('SYN-ANOM-TARGET') + 600))
    // G1: the holder's name is shown beside the id, on a reservation and on a loan.
    const person = async (path, field) => (await (await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } })).json())[field]
    const user509 = await person(`/admin/reservations/${syn('509')}`, 'user')
    check('T7 (G1) reservation 509 names its holder', !!user509?.displayName && r509.includes(user509.displayName), JSON.stringify(user509))
    await spaGo(page, `/reservations-prets?vue=prets&dossier=${syn('702')}`)
    await page.waitForTimeout(800)
    const holder702 = await person(`/admin/loans/${syn('702')}`, 'holder')
    const l702 = (await main(page)).replace(/\s+/g, ' ')
    check('T7 (G1) loan 702 names its holder', !!holder702?.displayName && l702.includes(holder702.displayName), JSON.stringify(holder702))
    await shot(page, 'transactions-loan-702-holder-fr-1440')
    await shot(page, 'transactions-reservation-509-fr-1440')
    check('T5 no page error on /reservations-prets', page.errors.length === 0, page.errors.join(' | ') || 'none')
    await page.context().close()
  },

  async audit() {
    const page = await open()
    await signIn(page)
    await nav(page, 'Audit')
    await axe(page, '/audit (fr, 1440)')
    // INVALID_CURSOR from the real server: the next-page cursor is replaced by a forged value.
    await page.route('**/api/v1/admin/audit-events?**', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has('cursor')) url.searchParams.set('cursor', 'forged-' + url.searchParams.get('cursor').slice(7))
      await route.continue({ url: url.toString() })
    })
    await page.getByRole('button', { name: 'Charger plus' }).click()
    await page.waitForTimeout(1200)
    const t = (await main(page)).replace(/\s+/g, ' ')
    check('U1 INVALID_CURSOR: the server answered 400 and the screen shows the restart notice',
      page.apiLog.some((l) => l.startsWith('400') && l.includes('cursor=')) && /recommenc|première page|reprendre/i.test(t),
      `${page.apiLog.filter((l) => l.includes('cursor=')).join(' | ')} :: ${t.match(/.{0,80}(curseur|recommenc|première page).{0,160}/i)?.[0] ?? t.slice(0, 200)}`)
    const focus = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 80))
    record('INFO', 'U1 focus after the cursor failure', focus)
    await shot(page, 'audit-invalid-cursor-fr-1440')
    await axe(page, '/audit INVALID_CURSOR notice (fr, 1440)')
    await page.unroute('**/api/v1/admin/audit-events?**')
    const restart = page.getByRole('button', { name: /Recommencer|première page|Reprendre/i })
    if (await restart.count()) {
      await restart.first().click(); await page.waitForTimeout(1000)
      const restarted = await main(page)
      const last = page.apiLog.at(-1) ?? ''
      check('U2 restart from the first page reloads the list',
        last.startsWith('200') && !last.includes('cursor=') && /\d+ événements chargés/.test(restarted) && !/La liste a changé/.test(restarted),
        `${last} :: ${restarted.match(/\d+ événements chargés/)?.[0]}`)
    } else record('INFO', 'U2 restart control', 'no restart button found by name')
    // D9: the server row seeded by checks.py reads {commandMessageId: QA-D9-KEPT}; a structured value injected into
    // the response must be counted, never printed.
    await page.route('**/api/v1/admin/audit-events?**', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      for (const item of body.items ?? []) if (item.details?.commandMessageId === 'QA-D9-KEPT') item.details.injected = { nested: 'QA-D9-STRUCTURED' }
      await route.fulfill({ response, json: body })
    })
    await spaGo(page, `/audit?sujet=${syn('b06')}`)
    await page.waitForTimeout(1200)
    const kept = page.getByText('QA-D9-KEPT').first()
    if (await kept.count()) { await kept.click(); await page.waitForTimeout(600) }
    const d9 = (await main(page)).replace(/\s+/g, ' ')
    check('U4 (D9) the scalar detail is shown, the structured one is counted and not printed',
      d9.includes('QA-D9-KEPT') && !/QA-D9-(STRUCTURED|NESTED|UNKNOWN)|QA-RAW-SENTINEL/.test(d9) && /champs? structurés? (n’est|ne sont) pas affichés?/.test(d9),
      d9.match(/.{0,160}QA-D9-KEPT.{0,200}/)?.[0] ?? d9.slice(0, 300))
    await shot(page, 'audit-d9-details-fr-1440')
    await page.unroute('**/api/v1/admin/audit-events?**')
    check('U3 no page error on /audit', page.errors.length === 0, page.errors.join(' | ') || 'none')
    await page.context().close()
  },

  async faults() {
    // List 404 is not produced by the real server; it is a routed fault to see the traced service error.
    const page = await open()
    await signIn(page)
    await page.route('**/api/v1/admin/anomalies?**', (route) => route.fulfill({
      // Same shape and header as a real Spring 404 (ApiError), only the ids are QA values.
      status: 404, contentType: 'application/problem+json', headers: { 'X-Request-Id': '0a0a0a0a-0000-4000-8000-0000000000aa' },
      body: JSON.stringify({ type: 'https://aegis.local/problems/resource-not-found', title: 'Ressource introuvable', status: 404,
        code: 'RESOURCE_NOT_FOUND', detail: 'La ressource demandée est absente ou n\'est pas visible.', instance: '/api/v1/admin/anomalies',
        traceId: '0a0a0a0a-0000-4000-8000-0000000000aa', timestamp: new Date().toISOString() }),
    }))
    await nav(page, 'Anomalies')
    const t = (await main(page)).replace(/\s+/g, ' ')
    check('F1 routed list 404 shows a service error with its trace, not an empty list', /0a0a0a0a-0000-4000-8000-0000000000aa/.test(t) && !/Aucune anomalie/.test(t), t.slice(0, 400))
    await shot(page, 'anomalies-list-404-routed-fr-1440')
    await axe(page, '/anomalies routed 404 (fr, 1440)')
    await page.unroute('**/api/v1/admin/anomalies?**')
    // Network down while on a loaded list, then refresh: stale data must be marked, not silently kept.
    await nav(page, 'Réservations et prêts')
    await page.route('**/api/v1/admin/reservations?**', (route) => route.abort('connectionrefused'))
    await page.getByRole('button', { name: 'Actualiser' }).click()
    await page.waitForTimeout(12000)
    const s = (await main(page)).replace(/\s+/g, ' ')
    record('INFO', 'F2 refresh with the API unreachable (routed)', s.slice(0, 400))
    await shot(page, 'transactions-refresh-unreachable-routed-fr-1440')
    await page.context().close()
  },

  async narrow() {
    for (const [w, h] of [[390, 844], [320, 720]]) {
      for (const theme of ['light', 'dark']) {
        const page = await open({ width: w, height: h, theme })
        await signIn(page)
        for (const [name, slug] of [['Réservations et prêts', 'transactions'], ['Anomalies', 'anomalies'], ['Audit', 'audit']]) {
          await nav(page, name)
          await noHScroll(page, `/${slug} ${w}px ${theme}`)
          await shot(page, `${slug}-fr-${theme}-${w}`)
          if (theme === 'light') await axe(page, `/${slug} (fr, ${w}px, light)`)
        }
        await spaGo(page, `/anomalies?statut=toutes&anomalie=${syn('b11')}`)
        await page.waitForTimeout(800)
        await noHScroll(page, `/anomalies dossier b11 ${w}px ${theme}`)
        await shot(page, `anomalies-b11-fr-${theme}-${w}`)
        await page.context().close()
      }
    }
  },

  async english() {
    const page = await open({ lang: 'en', theme: 'dark' })
    await signIn(page, 'en')
    for (const [name, slug] of [['Reservations & loans|Reservations and loans', 'transactions'], ['Anomalies', 'anomalies'], ['Audit', 'audit']]) {
      await page.getByRole('navigation', { name: /Sections/ }).getByRole('link', { name: new RegExp(name, 'i') }).click()
      await page.waitForLoadState('networkidle'); await page.waitForTimeout(400)
      const t = await main(page)
      const french = t.match(/\b(Réservations|Prêts|Statut|Gravité|Filtrer|Actualiser|Reconnue|Ouverte|Événement|Mis à jour|chargés)\b/g)
      check(`E1 ${slug} is fully English`, !french, french ? [...new Set(french)].join(', ') : 'no French catalog words')
      await shot(page, `${slug}-en-dark-1440`)
      await axe(page, `/${slug} (en, dark, 1440)`)
    }
    await page.context().close()
  },

  async keyboard() {
    const page = await open()
    await signIn(page)
    await nav(page, 'Anomalies')
    await spaGo(page, `/anomalies?statut=toutes`)
    await page.waitForTimeout(600)
    const stops = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      stops.push(await page.evaluate(() => {
        const e = document.activeElement
        const s = getComputedStyle(e)
        return `${e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}${s.outlineStyle === 'none' && s.boxShadow === 'none' ? ' [NO VISIBLE RING?]' : ''}`
      }))
    }
    record('INFO', 'K1 Tab order on /anomalies?statut=toutes (40 stops)', stops.join(' > '))
    // Tabbing past the last control leaves the page (activeElement is body) before wrapping to the skip link.
    const ringless = stops.filter((s) => s.includes('NO VISIBLE') && !s.startsWith('body:'))
    check('K1 every focus stop has a visible ring', stops.length > 0 && !ringless.length, ringless.join(' | ') || 'all stops styled')
    const wrap = stops.indexOf(stops.find((s) => s.startsWith('body:')))
    if (wrap >= 0) check('K2 after the wrap, focus resumes at the skip link', /^a:Aller au contenu|^a:Skip to/.test(stops[wrap + 1] ?? ''), stops[wrap + 1])
    await page.context().close()
  },
}

for (const [name, run] of Object.entries(scenarios)) {
  if (only && !only.has(name)) continue
  try { await run() } catch (e) { record('FAIL', `${name}: scenario aborted`, e.message.split('\n').slice(0, 3).join(' ')) }
}
await browser.close()
const count = (v) => results.filter((r) => r.verdict === v).length
console.log(`\nWEB REVIEW: ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('INFO')} INFO`)
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
