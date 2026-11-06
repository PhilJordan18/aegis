import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openCatalog, routeCatalogCommands, waitForCatalogState } from './catalogFakes.ts'
import { expectNoAxeViolations, expectNoHorizontalScroll } from './support.ts'

/**
 * Proposed CAT-01 forms (unit, model, archive confirmation, Modèles tab), offline on routed fakes: axe WCAG A/AA,
 * keyboard, no horizontal scroll at 320 px, light and dark. `AEGIS_FORMS_CAPTURE=1` also writes the compact review
 * batch to docs/design/manager-forms/captures/ — a proposal awaiting visual approval, never an approved design.
 */
const CAPTURE = process.env.AEGIS_FORMS_CAPTURE === '1'
const OUT = fileURLToPath(new URL('../../../docs/design/manager-forms/captures/', import.meta.url))

async function shot(page: Page, name: string) {
  if (!CAPTURE) return
  mkdirSync(OUT, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}${name}.png`, animations: 'disabled' })
}

async function start(page: Page) {
  await page.goto('/connexion')
  await openCatalog(page, 'nominal')
  await routeCatalogCommands(page)
  await waitForCatalogState(page, 'nominal')
}

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'mobile-320', width: 320, height: 640 },
] as const

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test.describe(`forms ${theme} ${viewport.name}`, () => {
      test.use({ colorScheme: theme, viewport: { width: viewport.width, height: viewport.height } })
      const suffix = `${viewport.name}-${theme}`

      test('unit form: empty, then local errors, then the server conflict on its field', async ({ page }) => {
        await start(page)
        await page.getByRole('button', { name: 'Nouvel exemplaire' }).click()
        const dialog = page.getByRole('dialog', { name: 'Nouvel exemplaire' })
        await expect(dialog.getByLabel(/^Modèle/)).toBeFocused()
        // Archived models are not offered for a new unit.
        await expect(dialog.getByLabel(/^Modèle/).locator('option')).toHaveCount(3)
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `unit-form-empty-${suffix}`)

        await dialog.getByRole('button', { name: 'Créer' }).click()
        await expect(dialog.getByLabel(/^Modèle/)).toBeFocused()
        await expect(dialog.getByLabel(/^Code de l’exemplaire/)).toHaveAttribute('aria-invalid', 'true')

        await dialog.getByLabel(/^Modèle/).selectOption({ label: 'Multimètre 1' })
        await expect(dialog.getByLabel('Calibration requise')).toBeChecked()
        await dialog.getByLabel(/^Code de l’exemplaire/).fill('MM-001')
        await dialog.getByLabel(/^Échéance de calibration/).fill('2027-01-15T09:30')
        await dialog.getByRole('button', { name: 'Créer' }).click()
        await expect(dialog.getByText('Ce code est déjà utilisé, exemplaires archivés compris.')).toBeVisible()
        // The form-level alert takes focus so it is read at once; the conflict stays on its field.
        await expect(dialog.locator('.ag-dialog__alert')).toBeFocused()
        await expect(dialog.getByLabel(/^Code de l’exemplaire/)).toHaveAttribute('aria-invalid', 'true')
        await expect(dialog.getByLabel(/^Code de l’exemplaire/)).toHaveValue('MM-001')
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `unit-form-conflict-${suffix}`)

        // Escape closes and focus goes back to the opener.
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Nouvel exemplaire' })).toBeFocused()
      })

      test('archive confirmation: Cancel first, then the refusal explained by its code', async ({ page }) => {
        await start(page)
        await page.getByRole('group', { name: 'Actions de l’exemplaire' }).getByRole('button', { name: 'Archiver' }).click()
        const dialog = page.getByRole('alertdialog')
        await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: 'Archiver' })).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(dialog.getByText('Impossible pendant un emprunt en cours.')).toBeVisible()
        await expect(dialog).not.toContainText('Détail serveur fictif')
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `archive-refused-${suffix}`)
      })

      test('Modèles tab and model form', async ({ page }) => {
        await start(page)
        await page.getByRole('link', { name: 'Modèles' }).click()
        await expect(page.getByRole('heading', { level: 2, name: '3 modèles' })).toBeVisible()
        await expect(page.getByRole('group', { name: 'Actions du modèle Ancien oscilloscope' })).toHaveCount(0)
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `models-list-${suffix}`)

        await page.getByRole('group', { name: 'Actions du modèle Multimètre 1' }).getByRole('button', { name: 'Modifier' }).click()
        const dialog = page.getByRole('dialog', { name: 'Modifier le modèle Multimètre 1' })
        await expect(dialog.getByLabel(/^Nom/)).toHaveValue('Multimètre 1')
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `model-form-edit-${suffix}`)
      })
    })
  }
}
