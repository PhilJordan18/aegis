import { defineConfig, devices } from '@playwright/test'

// AEGIS_E2E_PORT lets two worktrees run Playwright side by side (the dev server port is fixed otherwise).
const PORT = Number(process.env.AEGIS_E2E_PORT ?? 5180)
const reducedMotion = process.env.AEGIS_MOTION === 'no-preference' ? 'no-preference' : 'reduce'
// Opt-in live run (npm run test:realapi): when set, this file declares only the `realapi` project and starts no server.
const REAL_API = process.env.AEGIS_E2E_REAL_API === '1'

/**
 * Projects:
 * - `a11y` (npm run test:a11y): full route × state × viewport × theme matrix with
 *   axe WCAG A/AA, no horizontal scroll, and the flow tests; writes no image.
 *   entry.spec.ts runs in French (the browser locale below); language.spec.ts
 *   repeats the matrix in English and tests the language flows;
 * - `capture` (npm run capture): same matrix, PNGs in test-results/captures/ (ignored);
 * - `identity` (npm run test:identity): identity v3 measured on the rendered app (layout
 *   shift, painted contrast, focus, clipped text); writes no image;
 * - `evidence` (npm run capture:evidence): curated PNGs at 1× in
 *   docs/design/manager-entree/captures/, the only path outside apps/admin-web
 *   this tooling writes to;
 * - `integration` (npm run capture:integration): the curated FR/EN captures of the
 *   integrated identity v3 in docs/design/manager-v3/captures-integration/;
 * - `forms` (npm run test:forms): the CAT-01, CFG-02 and #26 forms, axe, keyboard and 320 px; with
 *   AEGIS_FORMS_CAPTURE=1 (npm run capture:forms) it writes the review batch to docs/design/manager-forms/captures/.
 * - `follow` (npm run test:follow): ADR-006 follow-up of the open operation dossier on a routed fake: no click, bounded
 *   request count, pause while hidden, stop at a terminal status; writes no image.
 * - `links` (npm run test:links): the links between custody dossiers (R2, R3) and the inline attempt (R4) on a routed fake:
 *   each link is clicked, its address and the request it sends are checked; writes no image.
 * - `labels` (npm run test:labels): lot 1 readability on a routed fake: bounded label reads for 20 rows, a unit named
 *   from its own identifier against a contradictory placement, no UUID outside « Détails techniques »; writes no image.
 * - `overview` (npm run test:overview): lot 2 Vue d'ensemble on a routed fake: each tile's filtered address, the
 *   acknowledgement in place (one request for two clicks), « N+ » on a partial read, tab order, and 1440/1024/390/320
 *   without horizontal scroll or axe violation; writes no image.
 * All start their own Vite dev server, where the design-review preview is enabled.
 *
 * `realapi` (npm run test:realapi) is the exception, and opt-in: it exists only when AEGIS_E2E_REAL_API=1, so
 * `npx playwright test` and every project above never see it. It starts no server: AEGIS_E2E_BASE_URL names a
 * `vite preview` of the production build whose /api proxies to a real Aegis Control API on an isolated stack, and the
 * administrator credentials come from AEGIS_E2E_ADMIN_EMAIL and AEGIS_E2E_ADMIN_PASSWORD at run time (e2e/realapi.spec.ts).
 */
function requiredEnv(name: string): string {
  const value = process.env[name]
  // A live run that cannot start must fail, never pass with every test skipped.
  if (!value) throw new Error(`test:realapi needs ${name} (see apps/admin-web/README.md, section « Recette navigateur contre une API réelle »).`)
  return value
}

const realApiProject = REAL_API
  ? {
      name: 'realapi',
      testMatch: 'realapi.spec.ts',
      // One API, one in-memory login rate limiter, a cookie session per context: keep the walks sequential.
      fullyParallel: false,
      use: { baseURL: requiredEnv('AEGIS_E2E_BASE_URL') },
    }
  : null

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  fullyParallel: true,
  workers: REAL_API ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    reducedMotion,
    trace: 'retain-on-failure',
  },
  projects: realApiProject ? [realApiProject] : [
    { name: 'a11y', testMatch: ['entry.spec.ts', 'language.spec.ts'], metadata: { capture: false } },
    { name: 'capture', testMatch: ['entry.spec.ts', 'language.spec.ts'], grepInvert: /flow:/, metadata: { capture: true } },
    { name: 'identity', testMatch: 'identity.spec.ts' },
    { name: 'evidence', testMatch: 'evidence.spec.ts' },
    { name: 'integration', testMatch: 'integration.spec.ts' },
    { name: 'forms', testMatch: 'forms.spec.ts' },
    { name: 'follow', testMatch: 'follow.spec.ts' },
    { name: 'links', testMatch: 'links.spec.ts' },
    { name: 'labels', testMatch: 'labels.spec.ts' },
    { name: 'overview', testMatch: 'overview.spec.ts' },
  ],
  webServer: REAL_API
    ? undefined
    : {
        command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
})
