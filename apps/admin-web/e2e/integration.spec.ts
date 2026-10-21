import { test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD, expectNoAxeViolations, expectNoHorizontalScroll, settle } from './support.ts'

/**
 * Curated captures of the integrated identity v3 (issue #79), 1× PNGs named
 * <screen>-<state>-<lang>-<theme>-<size>.png in docs/design/manager-v3/captures-integration/.
 * Same checks as the full matrix: axe and no horizontal scroll.
 */
const OUT = fileURLToPath(new URL('../../../docs/design/manager-v3/captures-integration/', import.meta.url))

const SIZES = {
  '1440': { width: 1440, height: 900 },
  '390': { width: 390, height: 844 },
  '320': { width: 320, height: 720 },
  // A 1280×800 window at 200 % browser zoom, emulated as 640×400 CSS px (the 2× density is dropped: captures are 1×).
  zoom200: { width: 640, height: 400 },
} as const

type Lang = 'fr' | 'en'
interface Capture {
  readonly screen: string
  readonly state: string
  readonly lang: Lang
  readonly theme: 'light' | 'dark'
  readonly size: keyof typeof SIZES
  readonly path: string
  readonly reach?: 'submit' | 'client-validation' | 'submit-role'
  readonly wait?: string
}

const CAPTURES: readonly Capture[] = [
  { screen: 'sign-in', state: 'nominal', lang: 'fr', theme: 'dark', size: '1440', path: '/connexion' },
  { screen: 'sign-in', state: 'nominal', lang: 'en', theme: 'light', size: '1440', path: '/connexion' },
  { screen: 'sign-in', state: 'invalid-credentials', lang: 'fr', theme: 'dark', size: '1440', path: '/connexion?apercu=identifiants-refuses', reach: 'submit', wait: 'invalidCredentials' },
  { screen: 'sign-in', state: 'validation', lang: 'fr', theme: 'light', size: '1440', path: '/connexion', reach: 'client-validation' },
  { screen: 'sign-in', state: 'rate-limited', lang: 'en', theme: 'light', size: '390', path: '/connexion?apercu=trop-de-tentatives', reach: 'submit', wait: 'rateLimited' },
  { screen: 'sign-in', state: 'service-error', lang: 'fr', theme: 'light', size: '390', path: '/connexion?apercu=erreur-service', reach: 'submit', wait: 'serviceError' },
  { screen: 'sign-in', state: 'role-unauthorized', lang: 'en', theme: 'dark', size: '1440', path: '/connexion?apercu=role-non-autorise', reach: 'submit-role' },
  { screen: 'sign-in', state: 'session-expired', lang: 'fr', theme: 'light', size: '1440', path: '/connexion?apercu=session-expiree' },
  { screen: 'sign-in', state: 'nominal', lang: 'fr', theme: 'dark', size: '320', path: '/connexion' },
  { screen: 'sign-in', state: 'invalid-credentials', lang: 'fr', theme: 'light', size: 'zoom200', path: '/connexion?apercu=identifiants-refuses', reach: 'submit', wait: 'invalidCredentials' },
  { screen: 'landing', state: 'default', lang: 'fr', theme: 'light', size: '1440', path: '/' },
  { screen: 'landing', state: 'default', lang: 'en', theme: 'dark', size: '390', path: '/' },
  { screen: 'shell', state: 'equipment', lang: 'fr', theme: 'dark', size: '1440', path: '/apercu/equipements' },
  { screen: 'shell', state: 'equipment', lang: 'en', theme: 'light', size: '390', path: '/apercu/equipements' },
]

const LABELS = {
  fr: { email: 'Adresse courriel', password: /^Mot de passe$/, button: 'Se connecter' },
  en: { email: 'Email address', password: /^Password$/, button: 'Sign in' },
} as const

async function reach(page: Page, capture: Capture) {
  const labels = LABELS[capture.lang]
  if (capture.reach === 'client-validation') {
    await page.getByLabel(labels.email).fill(capture.lang === 'fr' ? 'admin@aegis' : 'admin@aegis')
    await page.getByRole('button', { name: labels.button }).click()
    await page.locator('[aria-invalid="true"]').first().waitFor()
  } else if (capture.reach) {
    await page.getByLabel(labels.email).fill(PREVIEW_EMAIL)
    await page.getByLabel(labels.password).fill(PREVIEW_PASSWORD)
    await page.getByRole('button', { name: labels.button }).click()
    if (capture.wait) await page.locator(`form[data-state="${capture.wait}"]`).waitFor()
    else await page.getByRole('heading', { level: 1 }).filter({ hasText: /administrat/i }).waitFor()
  }
}

for (const capture of CAPTURES) {
  const name = `${capture.screen}-${capture.state}-${capture.lang}-${capture.theme}-${capture.size}`
  test.describe(name, () => {
    test.use({
      viewport: SIZES[capture.size],
      deviceScaleFactor: 1,
      colorScheme: capture.theme,
      locale: capture.lang === 'fr' ? 'fr-CA' : 'en-CA',
    })

    test(name, async ({ page }) => {
      await page.goto(capture.path)
      await settle(page)
      await reach(page, capture)
      await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true, animations: 'disabled' })
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page)
    })
  })
}
