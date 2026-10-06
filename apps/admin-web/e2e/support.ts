import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export const APPEARANCE_STORAGE_KEY = 'aegis.manager.appearance' // src/features/appearance/appearance.ts
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

// Obviously fictitious values: the preview gateway ignores them and never contacts the API.
export const PREVIEW_EMAIL = 'revue@apercu.test'
export const PREVIEW_PASSWORD = 'valeur-fictive-apercu'

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
  expect(summary, 'axe WCAG A/AA violations').toEqual([])
}

export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(clientWidth)
}

/** Waits for what a capture depends on: preview strip, page heading, web fonts. */
export async function settle(page: Page) {
  await page.getByRole('region', { name: 'Mode aperçu' }).waitFor()
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([document.fonts.load('600 16px "Geist Variable"'), document.fonts.load('500 12px "Geist Mono Variable"')])
  })
}

export async function submitSignIn(page: Page) {
  await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

export function afterSubmit(expectedState: string, { email = PREVIEW_EMAIL, password = PREVIEW_PASSWORD } = {}) {
  return async (page: Page) => {
    await page.getByLabel('Adresse courriel').fill(email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await page.locator(`form[data-state="${expectedState}"]`).waitFor()
  }
}
