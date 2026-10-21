import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { THEMES, VIEWPORTS } from './matrix.ts'
import { expectNoAxeViolations, expectNoHorizontalScroll, settle, PREVIEW_EMAIL } from './support.ts'

/**
 * English pass of the accessibility matrix, plus the language flows (issue #78).
 * The design-review preview is French-only: its strip and its Équipements
 * content are not translated, only the shell around them follows the language.
 */
const CAPTURE_DIR = fileURLToPath(new URL('../test-results/captures/', import.meta.url))
const LANGUAGE_KEY = 'aegis.manager.language' // src/i18n/locale.ts
const APPEARANCE_KEY = 'aegis.manager.appearance'

// A catalog key rendered instead of its text would look like « signIn.heading ».
const KEY_PATH = /\b(?:brand|language|appearance|pageTitle|shell|landing|signIn|equipment|notFound)\.[a-zA-Z]+/

interface EnglishScenario {
  readonly route: string
  readonly state: string
  readonly path: string
  readonly title: string
  /** The preview pages keep French content; every other page must contain none of the French probes. */
  readonly previewContent?: boolean
  readonly reach?: (page: Page) => Promise<void>
}

const submit = (expectedState: string) => async (page: Page) => {
  await page.getByLabel('Email address').fill(PREVIEW_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill('valeur-fictive-apercu')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.locator(`form[data-state="${expectedState}"]`).waitFor()
}

const SIGN_IN = 'Sign in — Aegis Manager'

const SCENARIOS: readonly EnglishScenario[] = [
  { route: 'landing', state: 'default', path: '/', title: 'Aegis Manager' },
  { route: 'sign-in', state: 'idle', path: '/connexion', title: SIGN_IN },
  {
    route: 'sign-in',
    state: 'client-validation',
    path: '/connexion',
    title: SIGN_IN,
    reach: async (page) => {
      await page.getByLabel('Email address').fill('admin@aegis')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.locator('[aria-invalid="true"]').first().waitFor()
    },
  },
  { route: 'sign-in', state: 'sending', path: '/connexion?apercu=envoi', title: SIGN_IN, reach: submit('submitting') },
  { route: 'sign-in', state: 'invalid-credentials', path: '/connexion?apercu=identifiants-refuses', title: SIGN_IN, reach: submit('invalidCredentials') },
  { route: 'sign-in', state: 'rate-limited', path: '/connexion?apercu=trop-de-tentatives', title: SIGN_IN, reach: submit('rateLimited') },
  { route: 'sign-in', state: 'unreachable', path: '/connexion?apercu=service-injoignable', title: SIGN_IN, reach: submit('unreachable') },
  { route: 'sign-in', state: 'service-error', path: '/connexion?apercu=erreur-service', title: SIGN_IN, reach: submit('serviceError') },
  { route: 'sign-in', state: 'server-validation', path: '/connexion?apercu=validation', title: SIGN_IN, reach: submit('validation') },
  {
    route: 'sign-in',
    state: 'role-not-authorized',
    path: '/connexion?apercu=role-non-autorise',
    title: SIGN_IN,
    reach: async (page) => {
      await page.getByLabel('Email address').fill(PREVIEW_EMAIL)
      await page.getByLabel('Password', { exact: true }).fill('valeur-fictive-apercu')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByRole('heading', { level: 1, name: 'Access reserved for administrators' }).waitFor()
    },
  },
  { route: 'sign-in', state: 'session-expired', path: '/connexion?apercu=session-expiree', title: SIGN_IN },
  { route: 'sign-in', state: 'session-invalid', path: '/connexion?apercu=session-invalide', title: SIGN_IN },
  { route: 'sign-in', state: 'signed-out', path: '/connexion?apercu=deconnecte', title: SIGN_IN },
  { route: 'preview-equipment', state: 'nominal', path: '/apercu/equipements', title: 'Equipment — Aegis Manager', previewContent: true },
  {
    route: 'preview-equipment',
    state: 'account-menu',
    path: '/apercu/equipements',
    title: 'Equipment — Aegis Manager',
    previewContent: true,
    reach: async (page) => {
      const sidebar = page.getByRole('navigation', { name: 'Sections' })
      if (await sidebar.isVisible()) await sidebar.getByRole('button', { name: /Administrateur Démo/ }).click()
      else await page.getByRole('button', { name: 'Open menu' }).click()
      await page.getByRole('radio', { name: 'System' }).first().waitFor({ state: 'visible' })
    },
  },
  { route: 'not-found', state: 'default', path: '/nulle-part', title: 'Page not found — Aegis Manager' },
]

// Words that only the French catalog contains, for pages that must be fully English.
const FRENCH_PROBES = /Se connecter|Connexion|Adresse courriel|Mot de passe|Accueil|Équipements|Réessayez|Garanties|garanties|Autorisé|Langue/

test.describe('English accessibility matrix', () => {
  test.use({ locale: 'en-CA' })

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      // English follows the same sizes and the two system themes; the forced variants prove an override, not a language.
      if (theme.viewports !== 'all') continue

      test.describe(`${viewport.name} ${theme.name}`, () => {
        test.use({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor,
          colorScheme: theme.colorScheme,
        })

        for (const scenario of SCENARIOS) {
          const name = `en-${scenario.route}-${scenario.state}-${viewport.name}-${theme.name}`

          test(name, async ({ page }, testInfo) => {
            await page.goto(scenario.path)
            await settle(page)
            await scenario.reach?.(page)

            await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA')
            await expect(page).toHaveTitle(scenario.title)
            await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
            // In the shell the switch sits in the account menu, which is closed in the nominal state.
            if (!scenario.previewContent || scenario.state === 'account-menu') {
              await expect(page.getByRole('group', { name: 'Language' }).first()).toBeVisible()
            }

            const text = await page.evaluate(() => document.body.innerText)
            expect(text, 'catalog key visible').not.toMatch(KEY_PATH)
            if (!scenario.previewContent) expect(text, 'French text on an English page').not.toMatch(FRENCH_PROBES)

            if (testInfo.project.metadata.capture === true) {
              await page.screenshot({ path: `${CAPTURE_DIR}${name}.png`, fullPage: true, animations: 'disabled' })
            }
            await expectNoHorizontalScroll(page)
            await expectNoAxeViolations(page)
          })
        }
      })
    }
  }
})

test.describe('flow: language', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.describe('English browser', () => {
    test.use({ locale: 'en-CA' })

    test('flow: an English browser gets English, and nothing is stored until the user chooses', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Authorized. Observed. Traced.')
      expect(await page.evaluate(() => ({ ...window.localStorage }))).toEqual({})
    })

    test('flow: a stored French choice wins over the English browser', async ({ page }) => {
      await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LANGUAGE_KEY, 'fr'] as const)
      await page.goto('/connexion')
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA')
      await expect(page).toHaveTitle('Connexion — Aegis Manager')
      await expect(page.getByRole('radio', { name: 'Français' })).toBeChecked()
    })

    test('flow: English sign-in announces, validates and focuses in English', async ({ page }) => {
      await page.goto('/connexion?apercu=trop-de-tentatives')
      await settle(page)
      await page.getByLabel('Email address').fill(PREVIEW_EMAIL)
      await page.getByLabel('Password', { exact: true }).fill('valeur-fictive-apercu')
      await page.getByRole('button', { name: 'Sign in' }).click()
      const alert = page.getByRole('alert')
      await expect(alert).toContainText('Too many attempts.')
      await expect(alert).toContainText(/Try again in \d+\s+seconds?\./)
      await expect(page.getByText(/^Available in \d+:\d{2}$/)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-disabled', 'true')
    })

    test('flow: the service error shows the traceId untranslated', async ({ page }) => {
      await page.goto('/connexion?apercu=erreur-service')
      await settle(page)
      await page.getByLabel('Email address').fill(PREVIEW_EMAIL)
      await page.getByLabel('Password', { exact: true }).fill('valeur-fictive-apercu')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('alert')).toContainText('The service could not process the sign-in.')
      await expect(page.getByRole('alert')).toContainText('Trace ID:')
      await expect(page.locator('code')).toHaveText(/^[0-9a-f-]{8,}$/)
    })
  })

  test.describe('unsupported browser language', () => {
    test.use({ locale: 'es-MX' })

    test('flow: an unsupported browser language falls back to French', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autorisé. Observé. Tracé.')
    })
  })

  test('flow: switching by keyboard applies at once, persists across a reload, and the title follows the route', async ({ page }) => {
    await page.goto('/')
    await settle(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA')

    await page.getByRole('radio', { name: 'Français' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'English' })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'English' })).toBeFocused()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA')
    await expect(page.getByRole('group', { name: 'Language' })).toBeVisible()
    expect(await page.evaluate(() => ({ ...window.localStorage }))).toEqual({ [LANGUAGE_KEY]: 'en' })

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA')
    await expect(page.getByRole('radio', { name: 'English' })).toBeChecked()

    await page.getByRole('link', { name: 'Sign in' }).first().click()
    await expect(page).toHaveURL(/\/connexion$/)
    await expect(page).toHaveTitle('Sign in — Aegis Manager')
    await expect(page.getByLabel('Email address')).toBeFocused()

    await page.getByRole('radio', { name: 'Français' }).check()
    await expect(page).toHaveTitle('Connexion — Aegis Manager')
    await expect(page.getByLabel('Adresse courriel')).toBeVisible()
  })

  test('flow: each option is written in its own language and carries its own lang, without flags', async ({ page }) => {
    await page.goto('/connexion')
    await settle(page)
    const options = page.getByRole('group', { name: 'Langue' }).locator('label')
    await expect(options).toHaveText(['Français', 'English'])
    await expect(options.locator('[lang]')).toHaveCount(2)
    expect(await options.locator('[lang]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('lang')))).toEqual(['fr', 'en'])
    await expect(page.getByRole('group', { name: 'Langue' }).locator('img, svg')).toHaveCount(0)
  })

  test('flow: the language is set from the shell account menu, next to the appearance, and both persist alone', async ({ page }) => {
    await page.goto('/apercu/equipements')
    await settle(page)
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Administrateur Démo/ }).click()
    await page.getByRole('radio', { name: 'English' }).last().check()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA')
    await expect(page).toHaveTitle('Equipment — Aegis Manager')
    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => ({ ...window.localStorage }))).toEqual({ [LANGUAGE_KEY]: 'en', [APPEARANCE_KEY]: 'dark' })
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Equipment' })).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /Administrateur Démo/ })).toBeFocused()
  })

  test('flow: the English compact drawer is labelled in English and returns focus', async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LANGUAGE_KEY, 'en'] as const)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/apercu/equipements')
    await settle(page)
    const trigger = page.getByRole('button', { name: 'Open menu' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Menu' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close menu' })).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Equipment' })).toHaveAttribute('aria-current', 'page')
    await expect(dialog.getByRole('group', { name: 'Language' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  test('flow: the English skip link reaches the main content', async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LANGUAGE_KEY, 'en'] as const)
    await page.goto('/apercu/equipements')
    await settle(page)
    await page.getByLabel('Thème').focus()
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#contenu')).toBeFocused()
  })
})
