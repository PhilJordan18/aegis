import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openCatalog, routeCatalogCommands, waitForCatalogState } from './catalogFakes.ts'
import { DEMO_LOCKER_ID, openLockers, waitForLockerState } from './lockerFakes.ts'
import { expectNoAxeViolations, expectNoHorizontalScroll } from './support.ts'

/**
 * Proposed CAT-01 forms (unit, model, archive confirmation, Modèles tab) CFG-02 schedule editor and #26 identifiers and placement, offline on routed fakes: axe WCAG A/AA,
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

const LOCKER_ID = DEMO_LOCKER_ID
const A1 = '1ae77ae3-8490-4f09-9412-a7816b77bff9'
const A2 = '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10'
const A3 = '6d2e1c8f-3a5b-4e4c-8b72-1f9c8d3e5a21'
const IDENTIFIERS = [
  { id: '2b3c4d5e-6f70-4a81-9b92-a3b4c5d6e7f8', assetId: 'mm-002', type: 'RFID_UHF', value: 'E20034120123456789000001', active: true, assignedAt: '2026-11-02T14:00:00Z', revokedAt: null },
  { id: '4d5e6f70-8192-4aa3-9bb4-c5d6e7f8091a', assetId: 'mm-002', type: 'NFC', value: '04A224B2C35E80', active: false, assignedAt: '2026-10-20T13:00:00Z', revokedAt: '2026-11-02T14:00:00Z' },
]
const ADMIN_LOCKERS = {
  items: [
    {
      id: LOCKER_ID,
      code: 'AEGIS-DEMO-01',
      name: 'Casier de démonstration',
      topology: 'HUB_CELL',
      compartments: [
        { id: A1, code: 'A1', enabled: true, currentAsset: { id: '9a1f0000-0000-4000-8000-000000000203', assetCode: 'TH-203' } },
        { id: A2, code: 'A2', enabled: true, currentAsset: null },
        { id: A3, code: 'A3', enabled: false, currentAsset: null },
      ],
    },
  ],
  page: 0,
  size: 100,
  totalItems: 1,
  totalPages: 1,
}

/** Identifier history, locker list and the two custody refusals (09 §12.3–12.4, §16.2). */
async function routeCustody(page: Page) {
  const problemOf = (status: number, code: string) => ({
    type: `https://aegis.local/problems/${code.toLowerCase()}`,
    title: 'Fictif',
    status,
    code,
    detail: 'Détail serveur fictif, jamais affiché.',
    instance: '/api/v1/admin/assets',
    traceId: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30',
    timestamp: '2026-11-03T19:00:00Z',
  })
  await page.route(/\/api\/v1\/admin\/assets\/[^/]+\/identifiers$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IDENTIFIERS) })
      : route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify(problemOf(409, 'IDENTIFIER_ALREADY_ASSIGNED')) }),
  )
  await page.route(/\/api\/v1\/admin\/assets\/[^/]+\/placement$/, (route) =>
    route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify(problemOf(409, 'COMPARTMENT_ALREADY_OCCUPIED')) }),
  )
  await page.route('**/api/v1/admin/lockers?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADMIN_LOCKERS) }))
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

      test('custody: identifier history, then the assign and placement conflicts on their fields', async ({ page }) => {
        await start(page)
        // Registered after the catalog fakes, so they answer first; MM-002's history is read through them.
        await routeCustody(page)
        await page.locator('.ag-list__items a', { hasText: 'MM-002' }).click()
        await expect(page.getByRole('heading', { level: 2, name: /· MM-002$/ })).toBeVisible()
        const history = page.getByRole('list', { name: 'Historique des identifiants' })
        await expect(history).toContainText('E20034120123456789000001')
        await expect(history).toContainText('Révoqué')
        await page.getByRole('button', { name: 'Attribuer un identifiant' }).scrollIntoViewIfNeeded()
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `custody-section-${suffix}`)

        await page.getByRole('button', { name: 'Attribuer un identifiant' }).click()
        const assign = page.getByRole('dialog', { name: 'Attribuer un identifiant à MM-002' })
        await expect(assign.getByLabel(/^Type/)).toBeFocused()
        await assign.getByLabel(/^Valeur/).fill('E20034120123456789000001')
        await assign.getByRole('button', { name: 'Attribuer un identifiant' }).click()
        await expect(assign.getByText('Cette valeur est déjà attribuée à un identifiant actif.')).toBeVisible()
        await expect(assign.getByLabel(/^Valeur/)).toHaveAttribute('aria-invalid', 'true')
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `custody-assign-conflict-${suffix}`)
        await page.keyboard.press('Escape')
        await expect(assign).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Attribuer un identifiant' })).toBeFocused()

        await page.getByRole('button', { name: 'Modifier le placement' }).click()
        const placement = page.getByRole('dialog', { name: 'Placement de MM-002' })
        await placement.getByLabel(/^Casier/).selectOption({ value: LOCKER_ID })
        await expect(placement.getByLabel(/^Cellule/).locator('option')).toHaveText(['Choisir une cellule', 'A1 — occupée par TH-203', 'A2 — libre', 'A3 — désactivée'])
        await placement.getByLabel(/^Cellule/).selectOption({ value: A1 })
        await placement.getByLabel(/^Motif/).fill('Rangement après étalonnage')
        await placement.getByRole('button', { name: 'Enregistrer' }).click()
        await expect(placement.getByText('Un autre exemplaire occupe déjà cette cellule.')).toBeVisible()
        await expect(placement.getByLabel(/^Cellule/)).toHaveAttribute('aria-invalid', 'true')
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        await shot(page, `custody-placement-conflict-${suffix}`)
        await page.keyboard.press('Escape')
        await expect(placement).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Modifier le placement' })).toBeFocused()
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
