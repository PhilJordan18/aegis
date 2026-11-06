import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openCatalog, routeCatalogCommands, waitForCatalogState } from './catalogFakes.ts'
import { DEMO_LOCKER_ID, openLockers, waitForLockerState } from './lockerFakes.ts'
import { expectNoAxeViolations, expectNoHorizontalScroll } from './support.ts'

/**
 * Proposed CAT-01 forms (unit, model, archive confirmation, Modèles tab) and CFG-02 schedule editor, offline on routed fakes: axe WCAG A/AA,
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

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
/** Weekdays 07:00–17:00, weekend closed, in Toronto (09 §13.1). */
const SCHEDULE = {
  id: '7c1e2d34-5f60-4a71-8b92-a3b4c5d6e7f8',
  lockerId: DEMO_LOCKER_ID,
  timeZone: 'America/Toronto',
  createdAt: '2026-11-03T14:00:00Z',
  createdByUserId: '0b9d6a0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e',
  windows: DAYS.map((dayOfWeek, index) =>
    index < 5 ? { dayOfWeek, enabled: true, opensAt: '07:00:00', closesAt: '17:00:00' } : { dayOfWeek, enabled: false, opensAt: null, closesAt: null },
  ),
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

      test('unit search: a search over 100 graphemes is refused on its field, without a request', async ({ page }) => {
        const searched: string[] = []
        page.on('request', (request) => {
          const q = new URL(request.url()).searchParams.get('q')
          if (q !== null) searched.push(q)
        })
        await start(page)
        const search = page.getByRole('search', { name: 'Rechercher un exemplaire' })
        await search.getByRole('searchbox').fill('a'.repeat(101))
        await search.getByRole('button', { name: 'Rechercher' }).click()
        await expect(search.getByRole('searchbox')).toBeFocused()
        await expect(search.getByRole('searchbox')).toHaveAttribute('aria-invalid', 'true')
        expect(searched).toEqual([])
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `unit-search-error-${suffix}`)
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

      test('schedule editor: seven days read from the server, then a local error on its day', async ({ page }) => {
        const writes: string[] = []
        await page.route('**/api/v1/admin/lockers/*/operating-schedule', (route) => {
          if (route.request().method() !== 'GET') {
            writes.push(route.request().method())
            return route.abort('failed')
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCHEDULE) })
        })
        await page.goto('/connexion')
        await openLockers(page, 'nominal')
        await waitForLockerState(page, 'nominal')
        await page.getByRole('button', { name: 'Modifier l’horaire' }).click()
        const dialog = page.getByRole('dialog', { name: /^Horaire d’exploitation du casier/ })
        await expect(dialog.getByLabel(/^Fuseau horaire/)).toBeFocused()
        await expect(dialog.getByLabel(/^Fuseau horaire/)).toHaveValue('America/Toronto')
        await expect(dialog.getByRole('group', { name: 'Samedi' }).getByText('Fermé toute la journée')).toBeVisible()
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `schedule-form-${suffix}`)

        const monday = dialog.getByRole('group', { name: 'Lundi' })
        await monday.getByLabel(/^Fermeture/).fill('06:00')
        await dialog.getByRole('button', { name: 'Enregistrer' }).click()
        await expect(monday.getByLabel(/^Fermeture/)).toBeFocused()
        await expect(monday.getByText('La fermeture doit suivre l’ouverture, le même jour.')).toBeVisible()
        expect(writes).toEqual([])
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `schedule-form-error-${suffix}`)

        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Modifier l’horaire' })).toBeFocused()
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
