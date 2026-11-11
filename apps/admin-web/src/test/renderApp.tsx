import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { clearCacheOnSessionChange, createQueryClient } from '../api/serverState'
import { createHistoryRouter, RouterContext, type Router } from '../app/router'
import { createAppearanceController } from '../features/appearance/appearance'
import { AppearanceContext } from '../features/appearance/useAppearance'
import { unconfiguredAnomalyGateway, type AnomalyGateway } from '../features/anomalies/anomalyGateway'
import { AnomalyGatewayContext } from '../features/anomalies/AnomalyGatewayContext'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { AuthGatewayContext } from '../features/auth/AuthGatewayContext'
import { createSessionStore, SessionContext, type SessionStore } from '../features/auth/session'
import { unconfiguredCatalogGateway, type CatalogGateway } from '../features/catalog/catalogGateway'
import { CatalogGatewayContext } from '../features/catalog/CatalogGatewayContext'
import { unconfiguredLockerGateway, type LockerGateway } from '../features/lockers/lockerGateway'
import { LockerGatewayContext } from '../features/lockers/LockerGatewayContext'
import { unconfiguredScheduleGateway, type ScheduleGateway } from '../features/schedule/scheduleGateway'
import { ScheduleGatewayContext } from '../features/schedule/ScheduleGatewayContext'
import { unconfiguredTransactionGateway, type TransactionGateway } from '../features/transactions/transactionGateway'
import { TransactionGatewayContext } from '../features/transactions/TransactionGatewayContext'
import { unconfiguredCustodyGateway, type CustodyGateway } from '../features/custody/custodyGateway'
import { CustodyGatewayContext } from '../features/custody/CustodyGatewayContext'
import { createLocaleController, type Locale, type LocaleController } from '../i18n/locale'
import { LocaleContext } from '../i18n/useI18n'

export function renderWithProviders(
  ui: ReactNode,
  {
    gateway = unconfiguredAuthGateway,
    catalogGateway = unconfiguredCatalogGateway,
    lockerGateway = unconfiguredLockerGateway,
    scheduleGateway = unconfiguredScheduleGateway,
    custodyGateway = unconfiguredCustodyGateway,
    transactionGateway = unconfiguredTransactionGateway,
    anomalyGateway = unconfiguredAnomalyGateway,
    session = createSessionStore(),
    router = createHistoryRouter(window),
    queryClient = createQueryClient(),
    locale = 'fr',
    localeController = createLocaleController(window, { initial: locale }),
  }: {
    gateway?: AuthGateway
    catalogGateway?: CatalogGateway
    lockerGateway?: LockerGateway
    scheduleGateway?: ScheduleGateway
    custodyGateway?: CustodyGateway
    transactionGateway?: TransactionGateway
    anomalyGateway?: AnomalyGateway
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
              <AuthGatewayContext value={gateway}>
                <CatalogGatewayContext value={catalogGateway}>
                  <LockerGatewayContext value={lockerGateway}>
                    <ScheduleGatewayContext value={scheduleGateway}>
                      <CustodyGatewayContext value={custodyGateway}>
                        <TransactionGatewayContext value={transactionGateway}>
                          <AnomalyGatewayContext value={anomalyGateway}>{ui}</AnomalyGatewayContext>
                        </TransactionGatewayContext>
                      </CustodyGatewayContext>
                    </ScheduleGatewayContext>
                  </LockerGatewayContext>
                </CatalogGatewayContext>
              </AuthGatewayContext>
            </SessionContext>
          </LocaleContext>
        </AppearanceContext>
      </RouterContext>
    </QueryClientProvider>,
  )
  return { ...result, session, router, appearance, locale: localeController, queryClient, stopClearing }
}
