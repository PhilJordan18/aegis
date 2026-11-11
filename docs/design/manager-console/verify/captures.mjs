// Captures du prototype (1x, PNG) : <écran>-<état>-<langue>-<apparence>-<taille>.png dans ../captures/
// Usage : node verify/captures.mjs   (depuis la racine du dépôt, après `npm ci` dans apps/admin-web)
import { chromium, open, url, PROTO, CAPTURES } from './lib.mjs'
import fs from 'node:fs'

fs.rmSync(CAPTURES, { recursive: true, force: true })
fs.mkdirSync(CAPTURES, { recursive: true })
const browser = await chromium.launch()

// Les identifiants des fixtures sont déterministes : on les lit dans la page plutôt que de les recopier.
const probe = await open(browser, PROTO + 'overview.html')
const ID = await probe.page.evaluate(() => {
  const fx = window.AG.fx
  return { O0: fx.uid('O0'), O1: fx.uid('O1'), AN2: fx.uid('AN2'), L1: fx.uid('L1'), R1: fx.uid('R1') }
})
await probe.ctx.close()

const D = { width: 1440, height: 900 }
const M = { width: 390, height: 844 }
const XS = { width: 320, height: 640 }

// [nom, page, état, langue, thème, viewport, paramètres, options]
const LIST = [
  // --- un écran, FR sombre et EN clair à 1440; FR clair à 390
  ['overview-nominal-fr-dark-1440', 'overview', 'nominal', 'fr', 'dark', D, '', { full: true }],
  ['overview-nominal-en-light-1440', 'overview', 'nominal', 'en', 'light', D, '', { full: true }],
  ['overview-nominal-fr-light-390', 'overview', 'nominal', 'fr', 'light', M, '', { full: true }],
  ['reservations-loans-fr-dark-1440', 'reservations', 'nominal', 'fr', 'dark', D, '&tab=loans'],
  ['reservations-reservations-en-light-1440', 'reservations', 'nominal', 'en', 'light', D, '&tab=reservations'],
  ['reservations-loans-fr-light-390', 'reservations', 'nominal', 'fr', 'light', M, '&tab=loans', { full: true }],
  ['reservations-operations-fr-dark-1440', 'reservations', 'nominal', 'fr', 'dark', D, `&tab=operations&sel=${ID.O0}`],
  ['anomalies-nominal-fr-dark-1440', 'anomalies', 'nominal', 'fr', 'dark', D, ''],
  ['anomalies-all-en-light-1440', 'anomalies', 'nominal', 'en', 'light', D, `&status=ALL&sel=${ID.AN2}`],
  ['anomalies-nominal-fr-light-390', 'anomalies', 'nominal', 'fr', 'light', M, '', { full: true }],
  ['audit-nominal-fr-dark-1440', 'audit', 'nominal', 'fr', 'dark', D, ''],
  ['audit-nominal-en-light-1440', 'audit', 'nominal', 'en', 'light', D, '&filters=1'],
  ['audit-nominal-fr-light-390', 'audit', 'nominal', 'fr', 'light', M, '', { full: true }],
  // --- dialogue de reconnaissance
  ['anomalies-acknowledge-dialog-fr-dark-1440', 'anomalies', 'nominal', 'fr', 'dark', D, '&dialog=1&note=' + encodeURIComponent('Inspection de la cellule A1 planifiée avec le responsable du laboratoire.')],
  ['anomalies-acknowledge-dialog-fr-light-390', 'anomalies', 'nominal', 'fr', 'light', M, '&dialog=1&note=' + encodeURIComponent('Inspection de la cellule A1 planifiée.')],
  ['anomalies-ack-conflict-fr-dark-1440', 'anomalies', 'ack-resolved', 'fr', 'dark', D, '&dialog=1&note=' + encodeURIComponent('Inspection planifiée.'), { submit: true }],
  // --- états défavorables
  ['reservations-empty-fr-light-1440', 'reservations', 'empty', 'fr', 'light', D, '&tab=loans'],
  ['overview-all-clear-fr-dark-1440', 'overview', 'all-clear', 'fr', 'dark', D, '', { full: true }],
  ['overview-service-error-fr-dark-1440', 'overview', 'service-error', 'fr', 'dark', D, ''],
  ['anomalies-service-error-en-light-1440', 'anomalies', 'service-error', 'en', 'light', D, ''],
  ['reservations-service-error-fr-dark-1440', 'reservations', 'service-error', 'fr', 'dark', D, '&tab=loans'],
  ['overview-partial-fr-light-1440', 'overview', 'partial', 'fr', 'light', D, '', { full: true }],
  ['overview-locker-offline-fr-dark-1440', 'overview', 'locker-offline', 'fr', 'dark', D, '', { full: true }],
  ['audit-invalid-cursor-fr-light-1440', 'audit', 'invalid-cursor', 'fr', 'light', D, ''],
  ['anomalies-forbidden-en-dark-1440', 'anomalies', 'forbidden', 'en', 'dark', D, ''],
  ['reservations-loans-en-dark-320', 'reservations', 'nominal', 'en', 'dark', XS, '&tab=loans', { full: true }],
]

for (const [name, page, state, lang, theme, vp, extra, opt = {}] of LIST) {
  const { ctx, page: p, errors, external } = await open(browser, url(page, { state, lang, theme, extra }), vp)
  if (opt.submit) {
    await p.click('#ack-submit')
    await p.waitForSelector('#ack-alert .ag-alert')
    await p.waitForTimeout(150)
  }
  await p.screenshot({ path: `${CAPTURES}/${name}.png`, fullPage: !!opt.full })
  if (errors.length || external.length) console.log('PROBLÈME', name, errors, external)
  await ctx.close()
}
await browser.close()
console.log(fs.readdirSync(CAPTURES).length, 'captures dans', CAPTURES)
