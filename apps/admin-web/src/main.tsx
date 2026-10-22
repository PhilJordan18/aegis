import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Global styles first: component stylesheets imported below must come after the reset.
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import { clearCacheOnSessionChange, createQueryClient } from './api/serverState'
import { App } from './app/App'
import { createHistoryRouter, RouterContext } from './app/router'
import { createAppearanceController } from './features/appearance/appearance'
import { AppearanceContext } from './features/appearance/useAppearance'
import type { AuthGateway } from './features/auth/authGateway'
import { AuthGatewayContext } from './features/auth/AuthGatewayContext'
import { createHttpAuthGateway } from './features/auth/httpAuthGateway'
import { createSessionStore, SessionContext } from './features/auth/session'
import { createLocaleController } from './i18n/locale'
import { LocaleContext } from './i18n/useI18n'
import { PreviewContext, type PreviewControls } from './preview/PreviewContext'

const router = createHistoryRouter(window)
const session = createSessionStore()
const appearance = createAppearanceController(window)
// Applies <html lang> before the first render; the explicit choice wins over the browser's languages.
const locale = createLocaleController(window)
const queryClient = createQueryClient()
clearCacheOnSessionChange(queryClient, session)

// The design-review preview replaces the API with fixed scenarios; every other build talks to the API.
let gateway: AuthGateway = createHttpAuthGateway()
let previewControls: PreviewControls | null = null
if (__AEGIS_PREVIEW__) {
  const { installPreview } = await import('./preview/previewRuntime')
  const preview = installPreview({ router, session })
  gateway = preview.gateway
  previewControls = preview.controls
}

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterContext value={router}>
        <AppearanceContext value={appearance}>
          <LocaleContext value={locale}>
            <SessionContext value={session}>
              <AuthGatewayContext value={gateway}>
                <PreviewContext value={previewControls}>
                  <App />
                </PreviewContext>
              </AuthGatewayContext>
            </SessionContext>
          </LocaleContext>
        </AppearanceContext>
      </RouterContext>
    </QueryClientProvider>
  </StrictMode>,
)
