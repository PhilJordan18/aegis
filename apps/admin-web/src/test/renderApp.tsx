import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { clearCacheOnSessionChange, createQueryClient } from '../api/serverState'
import { createHistoryRouter, RouterContext, type Router } from '../app/router'
import { createAppearanceController } from '../features/appearance/appearance'
import { AppearanceContext } from '../features/appearance/useAppearance'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { AuthGatewayContext } from '../features/auth/AuthGatewayContext'
import { createSessionStore, SessionContext, type SessionStore } from '../features/auth/session'
import { createLocaleController, type Locale, type LocaleController } from '../i18n/locale'
import { LocaleContext } from '../i18n/useI18n'

export function renderWithProviders(
  ui: ReactNode,
  {
    gateway = unconfiguredAuthGateway,
    session = createSessionStore(),
    router = createHistoryRouter(window),
    queryClient = createQueryClient(),
    locale = 'fr',
    localeController = createLocaleController(window, { initial: locale }),
  }: {
    gateway?: AuthGateway
    session?: SessionStore
    router?: Router
    queryClient?: QueryClient
    locale?: Locale
    /** Overrides `locale`, to exercise the real resolution (stored choice, browser languages). */
    localeController?: LocaleController
  } = {},
) {
  const appearance = createAppearanceController(window)
  const stopClearing = clearCacheOnSessionChange(queryClient, session)
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterContext value={router}>
        <AppearanceContext value={appearance}>
          <LocaleContext value={localeController}>
            <SessionContext value={session}>
              <AuthGatewayContext value={gateway}>{ui}</AuthGatewayContext>
            </SessionContext>
          </LocaleContext>
        </AppearanceContext>
      </RouterContext>
    </QueryClientProvider>,
  )
  return { ...result, session, router, appearance, locale: localeController, queryClient, stopClearing }
}
