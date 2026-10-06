import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
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

  test('flow: sign-in tab order starts at « Accueil », then the brand, then the email field', async ({ page }) => {
    await page.goto('/connexion')
    await settle(page)
    await page.getByRole('link', { name: 'Accueil', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Aegis Manager, accueil' })).toBeFocused()
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
    await expect(page.getByRole('alert')).toContainText("Ce compte technicien s'utilise dans l'application Aegis.")
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

  test('flow: reduced transparency makes the glass opaque and removes the decor', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
    await page.goto('/apercu/equipements')
    await settle(page)
    const sidebar = page.getByRole('navigation', { name: 'Sections' })
    const style = await sidebar.evaluate((element) => {
      const computed = getComputedStyle(element)
      return { backdrop: computed.backdropFilter, background: computed.backgroundColor }
    })
    expect(style.backdrop).toBe('none')
    expect(style.background).toBe('rgb(247, 249, 254)')
    await expect(page.locator('.ag-shell__bg')).toBeHidden()
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

// Review R1: the signature lit cell is either absent or fully visible, inside its
// container and the viewport, and at least 16 px from the card or panel.
const LIT_CELL_WIDTHS = [1440, 1280, 1024, 768, 640, 480, 390, 320]
const LIT_CELL_PAGES = [
  { name: 'landing', path: '/', container: '.ag-atmos', card: '.ag-atmos__figure', expectLitBelow768: true },
  { name: 'connexion', path: '/connexion', container: '.ag-signin', card: '.ag-signin__panel', expectLitBelow768: false },
]

test.describe('flow: lit cell geometry', () => {
  for (const pageCase of LIT_CELL_PAGES) {
    for (const width of LIT_CELL_WIDTHS) {
      test(`flow: lit cell ${pageCase.name} at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width <= 390 ? 720 : 900 })
        await page.goto(pageCase.path)
        await settle(page)
        const geometry = await page.evaluate(
          ({ container, card }) => {
            const rect = (element: Element) => element.getBoundingClientRect().toJSON() as DOMRect
            const lit = [...document.querySelectorAll('[data-lit-layer] i')].filter(
              (element) => getComputedStyle(element).visibility === 'visible' && element.getBoundingClientRect().width > 0,
            )
            const containerElement = document.querySelector(container)
            const cardElement = document.querySelector(card)
            return {
              count: lit.length,
              cell: lit[0] ? rect(lit[0]) : null,
              container: containerElement ? rect(containerElement) : null,
              card: cardElement ? rect(cardElement) : null,
              viewport: { width: document.documentElement.clientWidth },
            }
          },
          { container: pageCase.container, card: pageCase.card },
        )
        const expected = width >= 768 || pageCase.expectLitBelow768 ? 1 : 0
        expect(geometry.count).toBe(expected)
        if (expected === 0) return

        const { cell, container, card, viewport } = geometry
        if (!cell || !container || !card) throw new Error('missing geometry')
        expect(cell.left).toBeGreaterThanOrEqual(Math.max(container.left, 0))
        expect(cell.right).toBeLessThanOrEqual(Math.min(container.right, viewport.width))
        expect(cell.top).toBeGreaterThanOrEqual(container.top)
        expect(cell.bottom).toBeLessThanOrEqual(container.bottom)
        const gap = Math.max(card.left - cell.right, cell.left - card.right, card.top - cell.bottom, cell.top - card.bottom)
        expect(gap, 'distance between the lit cell and the card').toBeGreaterThanOrEqual(16)
      })
    }
  }
})
