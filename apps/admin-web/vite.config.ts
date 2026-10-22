/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { isPreviewEnabled } from './src/preview/previewFlag.ts'

/**
 * Local Aegis Control API. The dev and preview servers proxy /api to it, so
 * the browser stays same-origin (no CORS) and never sees PostgreSQL or MQTT.
 * AEGIS_API_ORIGIN (not exposed to the bundle) overrides it.
 */
const DEFAULT_API_ORIGIN = 'http://127.0.0.1:8080'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const preview = isPreviewEnabled({ command, previewVariable: env.VITE_AEGIS_PREVIEW })
  const apiProxy = { '/api': { target: process.env.AEGIS_API_ORIGIN ?? DEFAULT_API_ORIGIN } }
  return {
    plugins: [react()],
    server: { proxy: apiProxy },
    preview: { proxy: apiProxy },
    define: {
      __AEGIS_PREVIEW__: JSON.stringify(preview),
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  }
})
