import { defineConfig, devices } from '@playwright/test'

const PORT = 5180
const reducedMotion = process.env.AEGIS_MOTION === 'no-preference' ? 'no-preference' : 'reduce'

/**
 * Projects:
 * - `a11y` (npm run test:a11y): full route × state × viewport × theme matrix with
 *   axe WCAG A/AA, no horizontal scroll, and the flow tests; writes no image;
 * - `capture` (npm run capture): same matrix, PNGs in test-results/captures/ (ignored);
 * - `evidence` (npm run capture:evidence): ~16 curated PNGs at 1× in
 *   docs/design/manager-entree/captures/, the only path outside apps/admin-web
 *   this tooling writes to.
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
    { name: 'a11y', testMatch: 'entry.spec.ts', metadata: { capture: false } },
    { name: 'capture', testMatch: 'entry.spec.ts', grepInvert: /flow:/, metadata: { capture: true } },
    { name: 'evidence', testMatch: 'evidence.spec.ts' },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
