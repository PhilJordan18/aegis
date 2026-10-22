import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { openCatalog, waitForCatalogState } from './catalogFakes.ts'
import { SCENARIOS, THEMES, VIEWPORTS } from './matrix.ts'
import {
  APPEARANCE_STORAGE_KEY,
  PREVIEW_EMAIL,
  PREVIEW_PASSWORD,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  settle,
  submitSignIn,
} from './support.ts'

// Full matrix: ignored folder, never design evidence (see e2e/evidence.spec.ts for the curated set).
const CAPTURE_DIR = fileURLToPath(new URL('../test-results/captures/', import.meta.url))

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    if (theme.viewports !== 'all' && !theme.viewports.includes(viewport.name)) continue

    test.describe(`${viewport.name} ${theme.name}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        colorScheme: theme.colorScheme,
        ...(theme.forcedColors ? { forcedColors: theme.forcedColors } : {}),
      })

      if (theme.preference !== null) {
        const preference = theme.preference
        test.beforeEach(async ({ page }) => {
          await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [APPEARANCE_STORAGE_KEY, preference] as const)
        })
      }

      for (const scenario of SCENARIOS) {
        const name = `${scenario.route}-${scenario.state}-${viewport.name}-${theme.name}`

        test(name, async ({ page }, testInfo) => {
          await page.goto(scenario.path)
          await settle(page)
          await scenario.reach?.(page)

          await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA')
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme.expectedTheme)
          await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

          // Capture before asserting, so a state with a defect still leaves evidence to review.
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

test.describe('flow:', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('flow: keyboard-only sign-in reaches the equipment preview with focus on its heading', async ({ page }) => {
    await page.goto('/connexion?apercu=connecte')
    await settle(page)
    await expect(page.getByLabel('Adresse courriel')).toBeFocused()
    await page.keyboard.type(PREVIEW_EMAIL)
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Mot de passe', { exact: true })).toBeFocused()
    await page.keyboard.type(PREVIEW_PASSWORD)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Afficher le mot de passe' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/apercu\/equipements$/)
    await expect(page).toHaveTitle('Équipements — Aegis Manager')
    await expect(page.getByRole('heading', { level: 1, name: 'Équipements' })).toBeFocused()
  })

  test('flow: sign-in tab order is the brand, « Accueil », the language switch, then the email field', async ({ page }) => {
    await page.goto('/connexion')
    await settle(page)
    await page.getByRole('link', { name: 'Aegis Manager, accueil' }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Accueil', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    // One tab stop for the whole radio group: the checked option (French here, from the browser language).
    await expect(page.getByRole('radio', { name: 'Français' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Adresse courriel')).toBeFocused()
  })

  test('flow: a technician account is refused, the form is replaced, and no request follows', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto('/connexion?apercu=role-non-autorise')
    await settle(page)
    const before = requests.length
    await submitSignIn(page)
    const heading = page.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })
    await expect(heading).toBeFocused()
    await expect(page.getByRole('alert')).toContainText("Ce compte technicien s'utilise dans Aegis Mobile.")
    await expect(page.locator('form')).toHaveCount(0)
    expect(requests.slice(before)).toEqual([])
    await page.getByRole('button', { name: 'Se connecter avec un autre compte' }).click()
    await expect(page.getByLabel('Adresse courriel')).toBeFocused()
    await expect(page.getByLabel('Adresse courriel')).toHaveValue('')
  })

  test('flow: the preview switcher shows a state through the real form', async ({ page }) => {
    await page.goto('/connexion')
    await settle(page)
    await page.getByLabel('État').selectOption('identifiants-refuses')
    await expect(page.getByRole('alert')).toContainText('Adresse courriel ou mot de passe incorrect.')
    await expect(page).toHaveURL(/apercu=identifiants-refuses/)
    await page.getByLabel('Thème').selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('flow: the appearance preference is applied before first paint and persisted alone', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/apercu/equipements')
    await settle(page)
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Administrateur Démo/ }).click()
    await page.getByRole('radio', { name: 'Sombre' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /Administrateur Démo/ })).toBeFocused()

    await page.reload()
    // Set by the inline boot script, before React mounts.
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(await page.evaluate(() => ({ ...window.localStorage }))).toEqual({ [APPEARANCE_STORAGE_KEY]: 'dark' })
  })

  test('flow: nothing but the appearance preference reaches browser storage after a sign-in', async ({ page }) => {
    await page.goto('/connexion?apercu=connecte')
    await settle(page)
    await submitSignIn(page)
    await expect(page).toHaveURL(/\/apercu\/equipements$/)
    const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }))
    expect(storage).toEqual({ local: {}, session: {}, cookie: '' })
  })

  test('flow: fonts are served from the bundle, no CDN', async ({ page }) => {
    const fonts: string[] = []
    const foreign: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== 'http://127.0.0.1:5180') foreign.push(request.url())
      if (request.resourceType() === 'font') fonts.push(url.pathname)
    })
    await page.goto('/connexion?apercu=erreur-service')
    await settle(page)
    await submitSignIn(page)
    await page.locator('code').waitFor()
    expect(foreign).toEqual([])
    expect(fonts.some((path) => path.includes('geist-latin-wght-normal'))).toBe(true)
    expect(fonts.some((path) => path.includes('geist-mono-latin-wght-normal'))).toBe(true)
    expect(await page.evaluate(() => document.fonts.check('600 16px "Geist Variable"'))).toBe(true)
  })

  test('flow: no surface uses a blurred backdrop (no glass)', async ({ page }) => {
    for (const path of ['/', '/connexion', '/apercu/equipements']) {
      await page.goto(path)
      await settle(page)
      const blurred = await page.evaluate(() => [...document.querySelectorAll('*')].filter((element) => getComputedStyle(element).backdropFilter !== 'none').length)
      expect(blurred, `${path}: elements with a backdrop filter`).toBe(0)
    }
  })

  test('flow: reduced motion stops the busy indicator', async ({ page }) => {
    await page.goto('/connexion?apercu=envoi')
    await settle(page)
    await submitSignIn(page)
    const spinner = page.locator('.ag-spinner')
    await expect(spinner).toBeVisible()
    expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
    await expect(page.getByRole('button', { name: 'Connexion…' })).toHaveAttribute('aria-disabled', 'true')
  })

  test('flow: the compact drawer traps focus, closes with Escape and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/apercu/equipements')
    await settle(page)
    const trigger = page.getByRole('button', { name: 'Ouvrir le menu' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Menu' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Équipements' })).toHaveAttribute('aria-current', 'page')
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('flow: the skip link is the first focus stop of the shell and reaches the main content', async ({ page }) => {
    await page.goto('/apercu/equipements')
    await settle(page)
    await page.getByLabel('Thème').focus()
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Aller au contenu principal' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('#contenu')).toBeFocused()
  })
})

test.describe('flow: équipements (production page, routed fakes)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  async function openEquipment(page: import('@playwright/test').Page, mode: 'nominal' | 'paged' | 'long') {
    await page.goto('/connexion')
    await settle(page)
    const requests = await openCatalog(page, mode)
    await waitForCatalogState(page, mode)
    return requests
  }

  test('flow: the list is read from the API, the first unit is selected and the page asks nothing else', async ({ page }) => {
    const requests = await openEquipment(page, 'nominal')
    await expect(page).toHaveTitle('Équipements — Aegis Manager')
    await expect(page.getByRole('heading', { level: 2, name: '2 exemplaires' })).toBeVisible()
    const rows = page.locator('.ag-list__items a')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('heading', { level: 2, name: /Multimètre 1 · MM-001/ })).toBeVisible()
    // No invented readiness or presence.
    await expect(page.locator('main')).not.toContainText(/\bPrêt\b/)
    await expect(page.locator('main')).toContainText('Présence inconnue')
    await expect(page.locator('main')).toContainText('Aucun placement connu')
    // Only the two catalog routes, through the routed fakes.
    expect(requests.every((request) => /^GET \/api\/v1\/admin\/assets(\/[0-9a-f-]{36})?(\?|$)/.test(request))).toBe(true)
  })

  test('flow: keyboard selection with Tab and Enter changes the dossier, keeps the focus on the row and announces it', async ({ page }) => {
    await openEquipment(page, 'nominal')
    const second = page.locator('.ag-list__items a').nth(1)
    await page.locator('.ag-list__items a').first().focus()
    await page.keyboard.press('Tab')
    await expect(second).toBeFocused()
    // The focus ring is drawn, not removed.
    expect(await second.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/equipements\?exemplaire=00000000-0000-4000-8000-000000000002$/)
    await expect(second).toHaveAttribute('aria-current', 'true')
    await expect(second).toBeFocused()
    await expect(page.getByRole('heading', { level: 2, name: /Multimètre 2 · MM-002/ })).toBeVisible()
    await expect(page.locator('main')).toContainText('Calibration expirée depuis le 8 sept. 2026, 00 h 00 HAE')
    await expect(page.getByRole('status').filter({ hasText: 'Exemplaire sélectionné : Multimètre 2, MM-002.' })).toHaveCount(1)
    await page.goBack()
    await expect(page.locator('.ag-list__items a').first()).toHaveAttribute('aria-current', 'true')
  })

  test('flow: on a stacked layout a selection moves the focus to the dossier', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openEquipment(page, 'nominal')
    await page.locator('.ag-list__items a').nth(1).click()
    await expect(page.getByRole('group', { name: /Multimètre 2 · MM-002/ })).toBeFocused()
  })

  test('flow: pagination keeps the address, resets the selection and keeps focus on the pager', async ({ page }) => {
    const requests = await openEquipment(page, 'paged')
    await expect(page.getByRole('heading', { level: 2, name: '25 exemplaires' })).toBeVisible()
    await expect(page.locator('.ag-list__items a')).toHaveCount(20)
    const pager = page.getByRole('navigation', { name: 'Pagination des exemplaires' })
    await expect(pager.getByText('Page 1 sur 2')).toBeVisible()
    await expect(pager.getByRole('button', { name: 'Précédent' })).toHaveAttribute('aria-disabled', 'true')
    await pager.getByRole('button', { name: 'Suivant' }).click()
    await expect(page).toHaveURL(/\/equipements\?page=2$/)
    await expect(pager.getByText('Page 2 sur 2')).toBeVisible()
    await expect(page.locator('.ag-list__items a')).toHaveCount(5)
    await expect(pager.getByRole('button', { name: 'Suivant' })).toBeFocused()
    await expect(pager.getByRole('button', { name: 'Suivant' })).toHaveAttribute('aria-disabled', 'true')
    expect(requests.some((request) => request.includes('page=1&size=20&sort=assetCode%2Casc'))).toBe(true)
  })

  test('flow: the page offers no control that creates, edits, archives or saves', async ({ page }) => {
    await openEquipment(page, 'nominal')
    await expect(page.locator('main').getByRole('button')).toHaveCount(0)
    await expect(page.locator('main').locator('input, select, textarea')).toHaveCount(0)
  })

  test('flow: the « Modèles » tab is a dormant, non-focusable tab announced as coming', async ({ page }) => {
    await openEquipment(page, 'nominal')
    const tabs = page.getByRole('navigation', { name: 'Vues des équipements' })
    await expect(tabs.getByRole('link', { name: 'Exemplaires' })).toHaveAttribute('aria-current', 'page')
    await expect(tabs.getByRole('link', { name: 'Modèles' })).toHaveCount(0)
    await expect(tabs).toContainText('Modèles, à venir')
  })

  test('flow: long French content wraps without clipping or horizontal scroll at 200 % zoom', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 })
    await openEquipment(page, 'long')
    await expectNoHorizontalScroll(page)
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main a.ag-item, main .ag-dossier__scroll *')].filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible').length,
    )
    expect(clipped).toBe(0)
  })
})
