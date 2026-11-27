import { useEffect, useRef, useState } from 'react'
import { PageHeading } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import type { UserProfile } from '../features/auth/contract'
import { useSignOut } from '../features/auth/useSignOut'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { LAB_TIME_ZONE } from '../features/catalog/assetPresentation'
import { useScrollable } from '../features/lockers/useScrollable'
import { LockerConnectionBanners, LockersBlock } from '../features/overview/LockersModule'
import { ModuleAlert } from '../features/overview/OverviewModule'
import { AnomaliesBlock, LoansBlock, OperationsBlock, ReservationsBlock } from '../features/overview/OverviewBlocks'
import { oldestRead, readOf, summarizeAnomalies, summarizeLoans, summarizeOperations, type BlockRead } from '../features/overview/overviewModel'
import { useActiveReservations, useInProgressOperationReads, useLockerStatuses, useOpenAnomalies, useOpenLoanReads, useOverviewLockers, useOverviewRefresh } from '../features/overview/useOverviewQueries'
import { useLabelIndex } from '../features/labels/useLabelIndex'
import { LabelIndexNotice } from '../features/labels/LabelIndexNotice'
import { HelpButton, HelpPanel } from '../features/pageTools/PageHelp'
import { RefreshControl } from '../features/pageTools/RefreshControl'
import { usePageHelp } from '../features/pageTools/usePageHelp'
import { AcknowledgeDialog } from '../features/anomalies/AcknowledgeDialog'
import type { AnomalyView } from '../features/anomalies/contract'
import { SummaryBand } from '../features/overview/SummaryBand'
import { allClearOf, bandTiles } from '../features/overview/summaryBand'
import { useI18n } from '../i18n/useI18n'
import { Alert } from '../ui/Alert'
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
 * Above the blocks, the summary band (contrat-web-manager §2) links each count to its filtered page. Every row opens
 * the dossier in the page that owns it; the only actions here are the acknowledgement of an open anomaly, with the
 * dialog of the Anomalies page, and the locker's schedule when it is closed or has no zone.
 */
export function OverviewPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const currentProfile = useCurrentAdminProfile()
  const profile = currentProfile.data ?? sessionProfile

  const anomaliesQuery = useOpenAnomalies()
  const loanQueries = useOpenLoanReads()
  const operationQueries = useInProgressOperationReads()
  const reservationsQuery = useActiveReservations()
  const lockersQuery = useOverviewLockers()
  const refresh = useOverviewRefresh()
  const help = usePageHelp('overview')

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
  const labels = useLabelIndex()

  const reads: readonly BlockRead<unknown>[] = [anomalies, loans, operations, reservations, lockers]
  const readAt = oldestRead(reads)

  // Every block failed the same way: one alert says it once, instead of five copies of the same sentence (states §2).
  const failures = reads.flatMap((read) => (read.kind === 'failed' ? [read.failure] : []))
  const firstFailure = failures[0]
  const sameFailure = failures.length === reads.length && firstFailure !== undefined && firstFailure.kind !== 'ended' && failures.every((failure) => failure.kind === firstFailure.kind)

  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>(reads.map((read) => read.kind).join())

  const signOut = useSignOut()

  const anomaliesHeadingRef = useRef<HTMLHeadingElement>(null)
  const sessions = useRef(0)
  const focusTitleAfterClose = useRef(false)
  const [acknowledging, setAcknowledging] = useState<{ readonly session: number; readonly open: boolean; readonly anomaly: AnomalyView } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    if (acknowledging?.open !== false || !focusTitleAfterClose.current) return
    focusTitleAfterClose.current = false
    // The row and its button leave the block once the list is read again: the block's title takes focus.
    anomaliesHeadingRef.current?.focus()
  }, [acknowledging])
  const openAcknowledgement = (anomaly: AnomalyView) => {
    sessions.current += 1
    focusTitleAfterClose.current = false
    setAnnouncement('')
    setAcknowledging({ session: sessions.current, open: true, anomaly })
  }
  const closeAcknowledgement = () => setAcknowledging((current) => (current === null ? null : { ...current, open: false }))

  const lockerOffline = [...statuses.values()].some((query) => query.data?.connectionStatus === 'OFFLINE')
  const tiles = bandTiles({ anomalies, anomalyPage: anomaliesQuery.data, loans, lockers, statuses, operations, reservations }, i18n)
  const allClear = allClearOf(anomalies, loans, tiles, lockerOffline)
  const allQueries = [anomaliesQuery, ...loanQueries, ...operationQueries, reservationsQuery, lockersQuery, ...statusQueries]

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
          </div>
          <div className="ag-page__actions">
            <HelpButton help={help} />
            <RefreshControl onRefresh={refresh} readAt={readAt} stale={reads.some((read) => read.kind === 'ready' && read.stale)} />
          </div>
        </header>

        <HelpPanel help={help}>
          <p>{t.successiveReadsNote}</p>
          <p>{m.pageTools.labHours({ zone: LAB_TIME_ZONE })}</p>
          {labels.health === 'partial' && <p>{m.labels.partial}</p>}
        </HelpPanel>

        {!sameFailure && <LabelIndexNotice health={labels.health} onRetry={labels.retry} />}

        {sameFailure ? (
          <div className="ag-ov__pageerr">
            {firstFailure.kind === 'forbidden' ? (
              <Alert kind="error" icon="status-error" title={t.forbiddenPageTitle}>
                <p>{m.equipment.forbiddenBody}</p>
              </Alert>
            ) : (
              <ModuleAlert failure={firstFailure} onRetry={retryAll} retrying={anomaliesQuery.isFetching} />
            )}
          </div>
        ) : (
          <>
            <LockerConnectionBanners lockers={lockerPage} statuses={statuses} />
            <div className="ag-ov__scroll" ref={scrollRef} tabIndex={scrollable ? 0 : undefined} role={scrollable ? 'group' : undefined} aria-label={scrollable ? t.heading : undefined}>
              <SummaryBand tiles={tiles} allClear={allClear} onRetryStale={() => void refresh()} retrying={allQueries.some((query) => query.isFetching)} />
              <div className="ag-ov">
                <AnomaliesBlock
                  read={anomalies}
                  labels={labels}
                  retrying={anomaliesQuery.isFetching}
                  onRetry={refetchFailed([anomaliesQuery])}
                  onAcknowledge={openAcknowledgement}
                  headingRef={anomaliesHeadingRef}
                />
                <LoansBlock read={loans} retrying={loanQueries.some((query) => query.isFetching)} onRetry={refetchFailed(loanQueries)} />
                <LockersBlock read={lockers} statuses={statuses} retrying={lockersQuery.isFetching} onRetry={refetchFailed([lockersQuery])} />
                <OperationsBlock read={operations} labels={labels} retrying={operationQueries.some((query) => query.isFetching)} onRetry={refetchFailed(operationQueries)} />
                <ReservationsBlock read={reservations} retrying={reservationsQuery.isFetching} onRetry={refetchFailed([reservationsQuery])} />
              </div>
            </div>
          </>
        )}
        <p className="ag-sr-only" role="status">
          {announcement}
        </p>
        {acknowledging !== null && (
          <AcknowledgeDialog
            key={`acknowledge-${acknowledging.session}`}
            open={acknowledging.open}
            anomaly={acknowledging.anomaly}
            onClose={() => {
              // After a refusal the list is read again behind the dialog, and the row may be gone with its button.
              closeAcknowledgement()
            }}
            onAcknowledged={() => {
              focusTitleAfterClose.current = true
              setAnnouncement(t.acknowledgedAnnounce)
              closeAcknowledgement()
            }}
            onRefused={() => {
              focusTitleAfterClose.current = true
            }}
          />
        )}
      </main>
    </ManagerShell>
  )
}
