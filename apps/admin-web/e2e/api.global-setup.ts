/**
 * Acceptance guard for `npm run test:e2e:api`: without a reachable API the run
 * fails here, so it can never end with every test skipped and look green.
 * Same origin as the Vite proxy (vite.config.ts).
 */
export default async function globalSetup(): Promise<void> {
  const apiOrigin = process.env.AEGIS_API_ORIGIN ?? 'http://127.0.0.1:8080'
  const healthUrl = `${apiOrigin}/api/v1/system/health`
  const response = await fetch(healthUrl).catch(() => null)
  if (!response?.ok) {
    throw new Error(
      `Aegis Control API unreachable at ${healthUrl} (${response ? `HTTP ${response.status}` : 'no response'}). ` +
        'Start it with the demo accounts (services/api/README.md) before the acceptance run.',
    )
  }
}
