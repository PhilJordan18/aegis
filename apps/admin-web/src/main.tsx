import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Global styles first: component stylesheets imported below must come after the reset.
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './app/App'
import { createHistoryRouter, RouterContext } from './app/router'
import { createAppearanceController } from './features/appearance/appearance'
import { AppearanceContext } from './features/appearance/useAppearance'
import { unconfiguredAuthGateway, type AuthGateway } from './features/auth/authGateway'
import { AuthGatewayContext } from './features/auth/AuthGatewayContext'
import { createSessionStore, SessionContext } from './features/auth/session'
import { PreviewContext, type PreviewControls } from './preview/PreviewContext'

const router = createHistoryRouter(window)
const session = createSessionStore()
const appearance = createAppearanceController(window)

// No HTTP adapter in this slice: outside the preview, sign-in honestly reports the service as unreachable.
let gateway: AuthGateway = unconfiguredAuthGateway
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
    <RouterContext value={router}>
      <AppearanceContext value={appearance}>
        <SessionContext value={session}>
          <AuthGatewayContext value={gateway}>
            <PreviewContext value={previewControls}>
              <App />
            </PreviewContext>
          </AuthGatewayContext>
        </SessionContext>
      </AppearanceContext>
    </RouterContext>
  </StrictMode>,
)
