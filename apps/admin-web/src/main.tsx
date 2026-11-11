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
import { AnomalyGatewayContext } from './features/anomalies/AnomalyGatewayContext'
import { createHttpAnomalyGateway } from './features/anomalies/httpAnomalyGateway'
import { createHttpAuthGateway } from './features/auth/httpAuthGateway'
import { createSessionStore, SessionContext } from './features/auth/session'
import { CatalogGatewayContext } from './features/catalog/CatalogGatewayContext'
import { createHttpCatalogGateway } from './features/catalog/httpCatalogGateway'
import { createHttpLockerGateway } from './features/lockers/httpLockerGateway'
import { CustodyGatewayContext } from './features/custody/CustodyGatewayContext'
import { createHttpCustodyGateway } from './features/custody/httpCustodyGateway'
import { LockerGatewayContext } from './features/lockers/LockerGatewayContext'
import { createHttpScheduleGateway } from './features/schedule/httpScheduleGateway'
import { ScheduleGatewayContext } from './features/schedule/ScheduleGatewayContext'
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

// The catalog has no preview scenario: design-review captures route /api/v1/admin/assets themselves.
const catalogGateway = createHttpCatalogGateway()
// Same for the locker status: design-review captures route /api/v1/lockers/{id}/status themselves.
const lockerGateway = createHttpLockerGateway()
const scheduleGateway = createHttpScheduleGateway()
const custodyGateway = createHttpCustodyGateway()
const anomalyGateway = createHttpAnomalyGateway()

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
                <CatalogGatewayContext value={catalogGateway}>
                  <LockerGatewayContext value={lockerGateway}>
                    <ScheduleGatewayContext value={scheduleGateway}>
                      <CustodyGatewayContext value={custodyGateway}>
                        <AnomalyGatewayContext value={anomalyGateway}>
                          <PreviewContext value={previewControls}>
                            <App />
                          </PreviewContext>
                        </AnomalyGatewayContext>
                      </CustodyGatewayContext>
                    </ScheduleGatewayContext>
                  </LockerGatewayContext>
                </CatalogGatewayContext>
              </AuthGatewayContext>
            </SessionContext>
          </LocaleContext>
        </AppearanceContext>
      </RouterContext>
    </QueryClientProvider>
  </StrictMode>,
)
