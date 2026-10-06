/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { isPreviewEnabled } from './src/preview/previewFlag.ts'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const preview = isPreviewEnabled({ command, previewVariable: env.VITE_AEGIS_PREVIEW })
  return {
    plugins: [react()],
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
