import { test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { SCENARIOS } from './matrix.ts'
import { expectNoAxeViolations, expectNoHorizontalScroll, settle } from './support.ts'

/**
 * Curated design evidence (~16 PNGs at 1×), the only files written to
 * docs/design/manager-entree/captures/. Same checks as the full matrix.
 */
const EVIDENCE_DIR = fileURLToPath(new URL('../../../docs/design/manager-entree/captures/', import.meta.url))

const SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  reflow: { width: 320, height: 720 },
  zoom200: { width: 640, height: 400 },
} as const

interface EvidenceCase {
  readonly route: string
  readonly state: string
  readonly size: keyof typeof SIZES
  readonly theme: 'light' | 'dark' | 'forced-colors'
}

const CASES: readonly EvidenceCase[] = [
  { route: 'landing', state: 'defaut', size: 'desktop', theme: 'light' },
  { route: 'landing', state: 'defaut', size: 'desktop', theme: 'dark' },
  { route: 'landing', state: 'defaut', size: 'mobile', theme: 'light' },
  { route: 'connexion', state: 'inactif', size: 'desktop', theme: 'light' },
  { route: 'connexion', state: 'inactif', size: 'desktop', theme: 'dark' },
  { route: 'connexion', state: 'identifiants-refuses', size: 'desktop', theme: 'light' },
  { route: 'connexion', state: 'identifiants-refuses', size: 'mobile', theme: 'dark' },
  { route: 'connexion', state: 'trop-de-tentatives', size: 'desktop', theme: 'dark' },
  { route: 'connexion', state: 'service-injoignable', size: 'desktop', theme: 'light' },
  { route: 'connexion', state: 'session-expiree', size: 'desktop', theme: 'light' },
  { route: 'connexion', state: 'role-non-autorise', size: 'desktop', theme: 'dark' },
  { route: 'connexion', state: 'inactif', size: 'reflow', theme: 'light' },
  { route: 'connexion', state: 'identifiants-refuses', size: 'zoom200', theme: 'light' },
  { route: 'apercu-equipements', state: 'nominal', size: 'desktop', theme: 'light' },
  { route: 'apercu-equipements', state: 'nominal', size: 'desktop', theme: 'dark' },
  { route: 'apercu-equipements', state: 'nominal', size: 'desktop', theme: 'forced-colors' },
]

async function reach(page: Page, route: string, state: string) {
  const scenario = SCENARIOS.find((candidate) => candidate.route === route && candidate.state === state)
  if (!scenario) throw new Error(`Unknown scenario ${route}/${state}`)
  await page.goto(scenario.path)
  await settle(page)
  await scenario.reach?.(page)
}

for (const evidence of CASES) {
  const name = `${evidence.route}-${evidence.state}-${evidence.size}-${evidence.theme}`
  test.describe(name, () => {
    test.use({
      viewport: SIZES[evidence.size],
      deviceScaleFactor: 1,
      colorScheme: evidence.theme === 'dark' ? 'dark' : 'light',
      ...(evidence.theme === 'forced-colors' ? { forcedColors: 'active' as const } : {}),
    })

    test(name, async ({ page }) => {
      await reach(page, evidence.route, evidence.state)
      await page.screenshot({ path: `${EVIDENCE_DIR}${name}.png`, fullPage: true, animations: 'disabled' })
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page)
    })
  })
}
