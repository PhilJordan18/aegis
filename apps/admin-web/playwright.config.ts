import { defineConfig, devices } from '@playwright/test'

const PORT = 5180
const reducedMotion = process.env.AEGIS_MOTION === 'no-preference' ? 'no-preference' : 'reduce'

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
 *   integrated identity v3 in docs/design/manager-v3/captures-integration/.
 * All start their own Vite dev server, where the design-review preview is enabled.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  fullyParallel: true,
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
  projects: [
    { name: 'a11y', testMatch: ['entry.spec.ts', 'language.spec.ts'], metadata: { capture: false } },
    { name: 'capture', testMatch: ['entry.spec.ts', 'language.spec.ts'], grepInvert: /flow:/, metadata: { capture: true } },
    { name: 'identity', testMatch: 'identity.spec.ts' },
    { name: 'evidence', testMatch: 'evidence.spec.ts' },
    { name: 'integration', testMatch: 'integration.spec.ts' },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
