import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link } from '../app/Link'
import { PageHeading } from '../app/PageHeading'
import { useLocation, useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import type { UserProfile } from '../features/auth/contract'
import { useSessionStore } from '../features/auth/session'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { operationTypeLabel, transactionTimes } from '../features/transactions/transactionPresentation'
import { classifyTransactionFailure } from '../features/transactions/transactionFailure'
import { hasFilters, NO_FILTERS, readTransactionLocation, transactionHref, type TransactionFilterValues, type TransactionView } from '../features/transactions/transactionHref'
import { TransactionDossier } from '../features/transactions/TransactionDossier'
import { TransactionFilters } from '../features/transactions/TransactionFilters'
import { TransactionList } from '../features/transactions/TransactionList'
import { useTransactionDetail, useTransactionList, type TransactionRecord } from '../features/transactions/useTransactionQueries'
import { useI18n } from '../i18n/useI18n'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import '../app/page.css'
import '../features/catalog/equipment.css'
import '../features/transactions/transactions.css'

/** The dossier sits under the list below 1024 px, out of sight after a selection (handoff §5). */
function isStackedLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches
}

function revealDossier(target: HTMLElement | null) {
  target?.focus()
  target?.scrollIntoView?.({ block: 'start' })
}

function recordName(record: TransactionRecord, i18n: ReturnType<typeof useI18n>): string {
  switch (record.kind) {
    case 'reservations':
    case 'loans':
      return `${record.item.asset.model.name} ${record.item.asset.assetCode}`
    case 'operations':
      return `${operationTypeLabel(record.item.type, i18n)} ${transactionTimes(i18n).short(record.item.createdAt)}`
  }
}

/**
 * Protected Réservations et prêts page (#48): reservations, loans and physical locker operations of the server, read
 * only, as the Manager console approved by Philippe on 11 November 2026 shows them
 * (docs/design/manager-console/). The address holds the view, the filters, the page and the selected file, so a
 * bookmark, a refresh and the back button return to the same screen. No action here changes custody.
 */
export function ReservationsLoansPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.reservations
  const sessionStore = useSessionStore()
  const router = useRouter()
  const { search } = useLocation()
  const currentProfile = useCurrentAdminProfile()
  const profile = currentProfile.data ?? sessionProfile

  const location = readTransactionLocation(search)
  const { view, filters } = location
  const list = useTransactionList(view, filters, location.page)
  const page = list.data
  const filtered = hasFilters(filters)

  // A page past the end (a stale bookmark, a shrunk list) goes back to the last one.
  const lastPage = page !== undefined && !list.isPlaceholderData ? Math.max(page.totalPages - 1, 0) : null
  useEffect(() => {
    if (lastPage !== null && location.page > lastPage) router.navigate(transactionHref({ view, page: lastPage, filters }), { replace: true })
  }, [lastPage, location.page, router, view, filters])

  const items = page?.items ?? []
  const selectedId = location.selectedId ?? items[0]?.item.id ?? null
  const listed = items.find((record) => record.item.id === selectedId)
  const detail = useTransactionDetail(view, selectedId, listed)

  const [selectionNote, setSelectionNote] = useState('')
  const focusAfterSelection = useRef(false)
  const dossierRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusAfterSelection.current || selectedId === null) return
    if (dossierRef.current === null) return
    focusAfterSelection.current = false
    revealDossier(dossierRef.current)
  }, [selectedId, detail.data])

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  function select(record: TransactionRecord, event: MouseEvent<HTMLAnchorElement>) {
    // A modified click opens another tab: nothing changes here.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    setSelectionNote(t.selectedStatus({ name: recordName(record, i18n) }))
    // Side by side, focus stays on the row and the live region says what changed; stacked, the dossier is below the fold.
    if (!isStackedLayout()) return
    if (record.item.id === selectedId) revealDossier(dossierRef.current)
    else focusAfterSelection.current = true
  }

  function apply(next: TransactionFilterValues) {
    router.navigate(transactionHref({ view, filters: next }))
  }

  const listFailure = list.isError ? classifyTransactionFailure(list.error, 'list') : null
  const detailFailure = detail.isError ? classifyTransactionFailure(detail.error, 'detail') : null
  // A refresh the server refuses (403, 404) leaves no stale data: the file or the list can no longer be read.
  const listGone = list.isRefetchError && listFailure?.kind === 'forbidden'
  const detailGone = detail.isRefetchError && (detailFailure?.kind === 'forbidden' || detailFailure?.kind === 'notFound')
  const shownPage = listGone ? undefined : page
  const announcement = list.isPending ? t.loading : page !== undefined && !list.isPlaceholderData ? t.loaded({ count: page.totalItems, page: page.page + 1, pages: Math.max(page.totalPages, 1) }) : ''

  const empty = page !== undefined && page.totalItems === 0
  const showDossier = !empty && !(list.isError && shownPage === undefined)
  const refreshing = list.isFetching || detail.isFetching
  const readAt = Math.max(list.dataUpdatedAt, 0)

  const tabs: readonly { readonly view: TransactionView; readonly label: string }[] = [
    { view: 'reservations', label: t.tabReservations },
    { view: 'loans', label: t.tabLoans },
    { view: 'operations', label: t.tabOperations },
  ]

  return (
    <ManagerShell currentPath={pathOf('reservationsLoans')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{t.heading}</PageHeading>
            <p className="ag-page__lead">{t.lead}</p>
            <nav className="ag-tabs" aria-label={t.viewsLabel}>
              {tabs.map((tab) => (
                <Link key={tab.view} className="ag-tabs__tab" to={transactionHref({ view: tab.view })} aria-current={tab.view === view ? 'page' : undefined}>
                  {tab.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="ag-page__meta">
            {shownPage !== undefined && <span className="ag-page__time">{t.updatedAt({ time: transactionTimes(i18n).readAt(readAt) })}</span>}
            <Button
              variant="secondary"
              size="sm"
              busy={refreshing && !list.isPending}
              onClick={() => {
                if (refreshing) return
                void list.refetch()
                if (selectedId !== null) void detail.refetch()
              }}
            >
              <Icon name="refresh" />
              {t.refresh}
            </Button>
          </div>
        </header>

        <div className="ag-sr-only" role="status">
          {announcement}
        </div>
        <div className="ag-sr-only" role="status">
          {selectionNote}
        </div>

        <TransactionFilters
          key={`${view}|${search}`}
          view={view}
          values={filters}
          onApply={apply}
        />

        <div className={showDossier ? 'ag-eq' : 'ag-eq ag-eq--single'}>
          <TransactionList
            view={view}
            page={shownPage}
            selectedId={selectedId}
            filters={filters}
            filtered={filtered}
            loading={list.isPending}
            refreshing={list.isPlaceholderData}
            failure={listFailure}
            stale={list.isRefetchError && !listGone}
            retrying={list.isFetching}
            readAt={readAt}
            onRetry={() => void list.refetch()}
            onSelect={select}
            onPage={(next) => router.navigate(transactionHref({ view, page: next, filters }))}
            onClearFilters={() => router.navigate(transactionHref({ view, filters: NO_FILTERS }))}
          />
          {showDossier && (
            <TransactionDossier
              view={view}
              record={detailGone ? undefined : detail.data}
              loading={detail.isPending || list.isPending}
              failure={detailFailure}
              stale={detail.isRefetchError && !detailGone}
              retrying={detail.isFetching}
              readAt={detail.dataUpdatedAt}
              focusRef={dossierRef}
              onRetry={() => void detail.refetch()}
              onBack={() => router.navigate(transactionHref({ view, page: location.page, filters }))}
            />
          )}
        </div>
      </main>
    </ManagerShell>
  )
}
