import { defineConfig, devices } from '@playwright/test'

const PORT = 5181

/**
 * `npm run test:e2e:api`: the production build (no preview code), served by
 * `vite preview`, whose proxy sends /api to the local Aegis Control API.
 *
 * This is an acceptance run: it requires the API running with demo accounts
 * and, in this shell, the same AEGIS_DEMO_ADMIN_PASSWORD and
 * AEGIS_DEMO_TECHNICIAN_PASSWORD (see services/api/README.md). Missing
 * credentials fail before anything is built and an unreachable API fails in
 * global setup, so a run never passes with skipped tests. Offline checks are
 * `npm test` and the other Playwright projects, which do not load this file.
 */
if (!process.env.AEGIS_DEMO_ADMIN_PASSWORD || !process.env.AEGIS_DEMO_TECHNICIAN_PASSWORD) {
  throw new Error(
    'test:e2e:api is an acceptance run against the real API: set AEGIS_DEMO_ADMIN_PASSWORD and AEGIS_DEMO_TECHNICIAN_PASSWORD to the passwords the running API was started with.',
  )
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'api.spec.ts',
  globalSetup: './e2e/api.global-setup.ts',
  outputDir: './test-results/playwright-api',
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One API, one in-memory rate limiter: keep the attempts sequential.
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
