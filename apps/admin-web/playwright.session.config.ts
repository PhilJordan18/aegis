import { defineConfig, devices } from '@playwright/test'

const PORT = 5182

/**
 * `npm run test:e2e:session`: the browser session of ADR-016 (reload, deep link, revoked session,
 * sign-out) against route fakes of the auth and catalog APIs. Unlike the other offline projects it runs
 * the dev server in `api` mode, without the design-review preview, so the page uses the real HTTP auth
 * gateway and the browser really stores and sends the HttpOnly cookie that the fake sets. Nothing
 * reaches a real API: every /api/v1 request is answered by a route.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'session.spec.ts',
  outputDir: './test-results/playwright-session',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
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
    command: `npm run dev:api -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
