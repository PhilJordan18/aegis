import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { queryKeys } from '../api/queryKeys'
import { PageHeading } from '../app/PageHeading'
import { useLocation, useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import { AcknowledgeDialog, type RefusalReason } from '../features/anomalies/AcknowledgeDialog'
import { AnomalyDossier, type DossierOutcome } from '../features/anomalies/AnomalyDossier'
import { AnomalyFilterBar } from '../features/anomalies/AnomalyFilterBar'
import { AnomalyList } from '../features/anomalies/AnomalyList'
import { classifyAnomalyReadFailure } from '../features/anomalies/anomalyFailure'
import { anomaliesHref, ANOMALY_PAGE_SIZE, hasActiveFilter, NO_FILTERS, readAnomalyLocation, type AnomalyFilters } from '../features/anomalies/anomalyLocation'
import { anomalyName } from '../features/anomalies/anomalyPresentation'
import type { AnomalyListQuery, AnomalyView } from '../features/anomalies/contract'
import { useAnomaly, useAnomalyList } from '../features/anomalies/useAnomalyQueries'
import type { UserProfile } from '../features/auth/contract'
import { useSessionStore } from '../features/auth/session'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { useI18n } from '../i18n/useI18n'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import '../app/page.css'
import '../features/catalog/equipment.css'
import '../features/anomalies/anomalies.css'

/** The dossier sits under the list below 1024 px, out of sight after a selection (handoff §3). */
function isStackedLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches
}

function revealDossier(target: HTMLElement | null) {
  target?.focus()
  target?.scrollIntoView?.({ block: 'start' })
}

/** One open dialog at a time; `session` remounts it, so each opening starts from an empty note and a fresh key. */
interface AckSession {
  readonly session: number
  readonly open: boolean
  /** The anomaly as it was when the dialog opened: its description does not move under the administrator. */
  readonly anomaly: AnomalyView
}

/**
 * Protected Anomalies page (ANO-01 #52): the anomalies of the server, a filterable list and the dossier of one, and
 * the single action the Manager has on them, the acknowledgement. There is no resolve action: an anomaly is resolved
 * only by a new observation from the locker, which the server alone ingests. The screen follows the console direction
 * of docs/design/manager-console/ (approved on #158).
 */
export function AnomaliesPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const i18n = useI18n()
  const { m, format } = i18n
  const t = m.anomalies
  const sessionStore = useSessionStore()
  const router = useRouter()
  const client = useQueryClient()
  const { search } = useLocation()
  const currentProfile = useCurrentAdminProfile()
  // The login response already carries the profile; /auth/me refreshes it.
  const profile = currentProfile.data ?? sessionProfile

  const location = readAnomalyLocation(search)
  const { filters } = location
  const query: AnomalyListQuery = {
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.type === null ? {} : { type: filters.type }),
    ...(filters.severity === null ? {} : { severity: filters.severity }),
    page: location.page,
    size: ANOMALY_PAGE_SIZE,
  }
  const list = useAnomalyList(query)
  const page = list.data

  // A page past the end (a stale bookmark, a shrunk list) goes back to the last one.
  const lastPage = page !== undefined && !list.isPlaceholderData ? Math.max(page.totalPages - 1, 0) : null
  useEffect(() => {
    if (lastPage !== null && location.page > lastPage) router.navigate(anomaliesHref({ filters, page: lastPage, anomalyId: location.anomalyId }), { replace: true })
  }, [lastPage, location.page, location.anomalyId, filters, router])

  const listFailure = list.isError ? classifyAnomalyReadFailure(list.error, 'list') : null
  // A refresh the server refuses (403) leaves no stale data: the list can no longer be read.
  const listGone = list.isRefetchError && listFailure?.kind === 'forbidden'
  const shownPage = listGone ? undefined : page
  const items = shownPage?.items ?? []
  const selectedId = location.anomalyId ?? items[0]?.id ?? null
  const listed = items.find((anomaly) => anomaly.id === selectedId)
  const detail = useAnomaly(selectedId, listed)

  const detailFailure = detail.isError ? classifyAnomalyReadFailure(detail.error, 'detail') : null
  // A refresh the server refuses (403, 404) does not leave a stale dossier: the anomaly can no longer be shown.
  const detailGone = detailFailure !== null && (detailFailure.kind === 'forbidden' || detailFailure.kind === 'notFound')
  const detailRead = detail.data !== undefined && !detail.isPlaceholderData ? detail.data : null
  const shownAnomaly: AnomalyView | undefined = detailGone ? undefined : (detailRead ?? listed)
  const staleDetail = detail.isRefetchError && !detailGone && detailRead !== null
  // Initial failure of the detail while the list's copy is shown: the partial state; without a copy, the whole dossier.
  const dossierFailure = detailFailure !== null && !(detailRead !== null && !detailGone) ? detailFailure : null

  const empty = shownPage !== undefined && shownPage.totalItems === 0
  const showDossier = location.anomalyId !== null || (!empty && !(list.isError && shownPage === undefined))

  const [selectionNote, setSelectionNote] = useState('')
  const [outcomeState, setOutcomeState] = useState<{ readonly anomalyId: string; readonly kind: DossierOutcome } | null>(null)
  const outcome = outcomeState !== null && outcomeState.anomalyId === shownAnomaly?.id ? outcomeState.kind : null
  const focusAfterSelection = useRef(false)
  const dossierRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusAfterSelection.current || selectedId === null) return
    if (dossierRef.current === null) return
    focusAfterSelection.current = false
    revealDossier(dossierRef.current)
  }, [selectedId, detail.data])

  const [acknowledging, setAcknowledging] = useState<AckSession | null>(null)
  const sessions = useRef(0)
  const focusDossierAfterClose = useRef(false)
  const refusedInSession = useRef(false)
  useEffect(() => {
    if (acknowledging?.open !== false || !focusDossierAfterClose.current) return
    focusDossierAfterClose.current = false
    // The button that opened the dialog is gone once the status is no longer OPEN: the dossier takes focus.
    dossierRef.current?.focus()
  }, [acknowledging])

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  function openAcknowledgement(anomaly: AnomalyView) {
    // Pin the selection in the address: once acknowledged, the anomaly leaves « Ouvertes » and the list's first row changes.
    if (location.anomalyId === null) router.navigate(anomaliesHref({ ...location, anomalyId: anomaly.id }), { replace: true })
    sessions.current += 1
    refusedInSession.current = false
    setOutcomeState(null)
    setAcknowledging({ session: sessions.current, open: true, anomaly })
  }

  function closeAcknowledgement() {
    // After a refusal the dossier changed behind the dialog: focus goes to it, not to a button that is gone.
    if (refusedInSession.current) focusDossierAfterClose.current = true
    setAcknowledging((current) => (current === null ? null : { ...current, open: false }))
  }

  function acknowledged(anomaly: AnomalyView) {
    focusDossierAfterClose.current = true
    setOutcomeState({ anomalyId: anomaly.id, kind: 'acknowledged' })
    setAcknowledging((current) => (current === null ? null : { ...current, open: false }))
  }

  function refused(anomaly: AnomalyView, reason: RefusalReason) {
    refusedInSession.current = true
    setOutcomeState(reason === 'alreadyResolved' ? { anomalyId: anomaly.id, kind: 'resolvedMeanwhile' } : null)
  }

  function select(selected: AnomalyView, event: MouseEvent<HTMLAnchorElement>) {
    // A modified click opens another tab: nothing changes here.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    setSelectionNote(t.selectedStatus({ name: anomalyName(selected, i18n) }))
    setOutcomeState(null)
    // Side by side, focus stays on the row and the live region says what changed; stacked, the dossier is below the fold.
    if (!isStackedLayout()) return
    if (selected.id === selectedId) revealDossier(dossierRef.current)
    else focusAfterSelection.current = true
  }

  const applyFilters = (next: AnomalyFilters) => router.navigate(anomaliesHref({ filters: next, page: 0, anomalyId: null }))
  const clearFilters = () => router.navigate(anomaliesHref({ filters: NO_FILTERS, page: 0, anomalyId: null }))
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.anomalies.all })
  const time = (updatedAt: number) => (updatedAt > 0 ? format.time(new Date(updatedAt)) : null)
  const listReadAt = shownPage === undefined ? null : time(list.dataUpdatedAt)

  const listAnnouncement = list.isPending
    ? t.loading
    : shownPage !== undefined && !list.isPlaceholderData
      ? t.loaded({ count: shownPage.totalItems, page: shownPage.page + 1, pages: Math.max(shownPage.totalPages, 1) })
      : ''

  return (
    <ManagerShell currentPath={pathOf('anomalies')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{t.heading}</PageHeading>
            <p className="ag-an-lead">{t.lead}</p>
          </div>
          <div className="ag-an-meta">
            {listReadAt !== null && <span className="ag-an-meta__time">{t.updatedAt({ time: listReadAt })}</span>}
            <Button variant="secondary" size="sm" busy={list.isFetching} onClick={() => !list.isFetching && refresh()}>
              {t.refresh}
            </Button>
          </div>
        </header>

        <div className="ag-sr-only" role="status">
          {listAnnouncement}
        </div>
        <div className="ag-sr-only" role="status">
          {selectionNote}
        </div>

        <aside className="ag-an-reminder" aria-label={t.reminder}>
          <Icon name="info" />
          <p>
            <strong>{t.reminder}</strong> {t.reminderDetail}
          </p>
        </aside>

        <AnomalyFilterBar key={anomaliesHref({ filters, page: 0, anomalyId: null })} filters={filters} onApply={applyFilters} onClear={clearFilters} />

        <div className={showDossier ? 'ag-eq' : 'ag-eq ag-eq--single'}>
          <AnomalyList
            page={shownPage}
            selectedId={selectedId}
            loading={list.isPending}
            refreshing={list.isPlaceholderData}
            failure={listFailure}
            stale={list.isRefetchError && !listGone}
            retrying={list.isFetching}
            readAt={listReadAt}
            filtered={hasActiveFilter(filters)}
            hrefFor={(anomaly) => anomaliesHref({ filters, page: location.page, anomalyId: anomaly.id })}
            onRetry={() => void list.refetch()}
            onSelect={select}
            onPage={(next) => router.navigate(anomaliesHref({ filters, page: next, anomalyId: null }))}
            onClearFilters={clearFilters}
          />
          {showDossier && (
            <AnomalyDossier
              anomaly={shownAnomaly}
              detail={detailGone ? null : detailRead}
              loading={detail.isPending || list.isPending}
              failure={dossierFailure}
              stale={staleDetail}
              retrying={detail.isFetching}
              readAt={time(detail.dataUpdatedAt)}
              outcome={outcome}
              focusRef={dossierRef}
              onRetry={() => void detail.refetch()}
              onBack={() => router.navigate(anomaliesHref({ filters, page: location.page, anomalyId: null }))}
              onAcknowledge={() => shownAnomaly && openAcknowledgement(shownAnomaly)}
            />
          )}
        </div>
      </main>

      {acknowledging !== null && (
        <AcknowledgeDialog
          key={`acknowledge-${acknowledging.session}`}
          open={acknowledging.open}
          anomaly={acknowledging.anomaly}
          onClose={closeAcknowledgement}
          onAcknowledged={() => acknowledged(acknowledging.anomaly)}
          onRefused={(reason) => refused(acknowledging.anomaly, reason)}
        />
      )}
    </ManagerShell>
  )
}
