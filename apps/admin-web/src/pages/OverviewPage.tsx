import { PageHeading } from '../app/PageHeading'
import { useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import type { UserProfile } from '../features/auth/contract'
import { useSessionStore } from '../features/auth/session'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { LAB_TIME_ZONE } from '../features/catalog/assetPresentation'
import { useScrollable } from '../features/lockers/useScrollable'
import { LockerConnectionBanners, LockersBlock } from '../features/overview/LockersModule'
import { ModuleAlert } from '../features/overview/OverviewModule'
import { AnomaliesBlock, LoansBlock, OperationsBlock, ReservationsBlock } from '../features/overview/OverviewBlocks'
import { labelsOf, NO_LABELS, oldestRead, readOf, summarizeAnomalies, summarizeLoans, summarizeOperations, type BlockRead } from '../features/overview/overviewModel'
import { useActiveReservations, useInProgressOperationReads, useLockerStatuses, useOpenAnomalies, useOpenLoanReads, useOverviewLockers, useOverviewRefresh } from '../features/overview/useOverviewQueries'
import { transactionTimes } from '../features/transactions/transactionPresentation'
import { useI18n } from '../i18n/useI18n'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import '../app/page.css'
import '../features/catalog/equipment.css'
import '../features/overview/overview.css'
import '../features/transactions/transactions.css'

/**
 * Protected Vue d'ensemble (#159): what needs an administrator's attention, in the order of sections.md §5.1 (open
 * anomalies, overdue loans, locker, operations in progress, active reservations), read only, as the Manager console
 * approved on 11 November 2026 shows it (docs/design/manager-console/). Each block reads its own routes and keeps its
 * own loading, error, stale and empty states: a route that fails is an error in its block, never a zero, and never a
 * reason to hide another block. Counts are the server's; a count the contract cannot give is a minimum, said as such.
 * The page offers no action: every row opens the dossier in the page that owns it.
 */
export function OverviewPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const sessionStore = useSessionStore()
  const router = useRouter()
  const currentProfile = useCurrentAdminProfile()
  const profile = currentProfile.data ?? sessionProfile

  const anomaliesQuery = useOpenAnomalies()
  const loanQueries = useOpenLoanReads()
  const operationQueries = useInProgressOperationReads()
  const reservationsQuery = useActiveReservations()
  const lockersQuery = useOverviewLockers()
  const refresh = useOverviewRefresh()

  const anomalies = summarizeAnomalies(readOf(anomaliesQuery))
  const loans = summarizeLoans(loanQueries.map(readOf))
  const operations = summarizeOperations(operationQueries.map(readOf))
  const reservations = readOf(reservationsQuery)
  const lockers = readOf(lockersQuery)

  const lockerPage = lockers.kind === 'ready' ? lockers.value : undefined
  const statusQueries = useLockerStatuses(lockerPage?.items.map((locker) => locker.id) ?? [])
  const statuses = new Map<string, (typeof statusQueries)[number]>()
  lockerPage?.items.forEach((locker, index) => {
    const query = statusQueries[index]
    if (query !== undefined) statuses.set(locker.id, query)
  })
  const labels = lockerPage === undefined ? NO_LABELS : labelsOf(lockerPage)

  const reads: readonly BlockRead<unknown>[] = [anomalies, loans, operations, reservations, lockers]
  const readAt = oldestRead(reads)
  const times = transactionTimes(i18n)

  // Every block failed the same way: one alert says it once, instead of five copies of the same sentence (states §2).
  const failures = reads.flatMap((read) => (read.kind === 'failed' ? [read.failure] : []))
  const firstFailure = failures[0]
  const sameFailure = failures.length === reads.length && firstFailure !== undefined && firstFailure.kind !== 'ended' && failures.every((failure) => failure.kind === firstFailure.kind)

  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>(reads.map((read) => read.kind).join())

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  const refetchFailed = (queries: readonly { isError: boolean; refetch: () => unknown }[]) => () => queries.forEach((query) => query.isError && void query.refetch())
  const retryAll = () => {
    refetchFailed([anomaliesQuery, ...loanQueries, ...operationQueries, reservationsQuery, lockersQuery])()
  }

  return (
    <ManagerShell currentPath={pathOf('overview')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{t.heading}</PageHeading>
            <p className="ag-page__lead">{t.lead}</p>
            <p className="ag-page__lead">{t.zoneNote({ zone: LAB_TIME_ZONE })}</p>
          </div>
          <div className="ag-page__meta">
            {readAt !== null && <span className="ag-page__time">{t.updatedAt({ time: times.readAt(readAt) })}</span>}
            <Button variant="secondary" size="sm" busy={refresh.refreshing} onClick={refresh.refresh}>
              <Icon name="refresh" />
              {t.refresh}
            </Button>
          </div>
        </header>

        <p className="ag-sr-only" role="status">
          {refresh.refreshedAt === null || refresh.refreshing ? '' : t.refreshed({ time: times.readAt(refresh.refreshedAt) })}
        </p>

        {sameFailure ? (
          <div className="ag-ov__pageerr">
            {firstFailure.kind === 'forbidden' ? (
              <Alert kind="error" icon="status-error" title={t.forbiddenPageTitle}>
                <p>{m.equipment.forbiddenBody}</p>
              </Alert>
            ) : (
              <ModuleAlert failure={firstFailure} onRetry={retryAll} retrying={refresh.refreshing} />
            )}
          </div>
        ) : (
          <>
            <LockerConnectionBanners lockers={lockerPage} statuses={statuses} />
            <div className="ag-ov__scroll" ref={scrollRef} tabIndex={scrollable ? 0 : undefined} role={scrollable ? 'group' : undefined} aria-label={scrollable ? t.heading : undefined}>
              <div className="ag-ov">
                <AnomaliesBlock read={anomalies} labels={labels} retrying={anomaliesQuery.isFetching} onRetry={refetchFailed([anomaliesQuery])} />
                <LoansBlock read={loans} retrying={loanQueries.some((query) => query.isFetching)} onRetry={refetchFailed(loanQueries)} />
                <LockersBlock read={lockers} statuses={statuses} retrying={lockersQuery.isFetching} onRetry={refetchFailed([lockersQuery])} />
                <OperationsBlock read={operations} labels={labels} retrying={operationQueries.some((query) => query.isFetching)} onRetry={refetchFailed(operationQueries)} />
                <ReservationsBlock read={reservations} retrying={reservationsQuery.isFetching} onRetry={refetchFailed([reservationsQuery])} />
              </div>
            </div>
          </>
        )}
      </main>
    </ManagerShell>
  )
}
