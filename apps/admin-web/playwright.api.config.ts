import { defineConfig, devices } from '@playwright/test'

const PORT = 5181

/**
 * `npm run test:e2e:api`: the production build (no preview code), served by
 * `vite preview`, whose proxy sends /api to the local Aegis Control API.
 *
 * Requires the API running with demo accounts and, in this shell, the same
 * AEGIS_DEMO_ADMIN_PASSWORD and AEGIS_DEMO_TECHNICIAN_PASSWORD (see
 * services/api/README.md). Without them nothing is built and every test is
 * skipped, so offline runs never fail.
 */
const credentialsPresent = Boolean(process.env.AEGIS_DEMO_ADMIN_PASSWORD && process.env.AEGIS_DEMO_TECHNICIAN_PASSWORD)

export default defineConfig({
  testDir: './e2e',
  testMatch: 'api.spec.ts',
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
  webServer: credentialsPresent
    ? {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
})
