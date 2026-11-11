import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { PageHeading } from '../app/PageHeading'
import { useLocation, useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import type { UserProfile } from '../features/auth/contract'
import { useSessionStore } from '../features/auth/session'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { AuditDossier } from '../features/audit/AuditDossier'
import { AuditFilters } from '../features/audit/AuditFilters'
import { AuditList } from '../features/audit/AuditList'
import { classifyAuditFailure } from '../features/audit/auditFailure'
import { activeFilterFields, auditHref, NO_FILTERS, readAuditLocation, refusedFields, type AuditFilters as Filters, type FilterField } from '../features/audit/auditFilters'
import { eventLabel } from '../features/audit/auditPresentation'
import type { AuditEventView } from '../features/audit/contract'
import { useAuditTimeline } from '../features/audit/useAuditTimeline'
import { LAB_TIME_ZONE } from '../features/catalog/assetPresentation'
import { useI18n } from '../i18n/useI18n'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import '../app/page.css'
import '../features/catalog/equipment.css'
import '../features/audit/audit.css'

const LIST_TITLE_ID = 'audit-liste'

/** The dossier sits under the list below 1024 px, out of sight after a selection (handoff §5). */
function isStackedLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches
}

/**
 * Protected Audit page (#53), read only: the history of §19.1 as a timeline, with the filters of the contract and the
 * opaque, filter-bound cursor (D10). The list is newest first. A walk never repeats an event and holds what was
 * committed before it began; what is recorded during it appears on the next walk, started with « Actualiser » (no
 * snapshot is claimed). The page adds, completes and writes nothing, and says so when something is not shown.
 */
export function AuditPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const i18n = useI18n()
  const { m, format } = i18n
  const t = m.audit
  const sessionStore = useSessionStore()
  const router = useRouter()
  const { search } = useLocation()
  const currentProfile = useCurrentAdminProfile()
  const profile = currentProfile.data ?? sessionProfile

  const { filters, selectedId, unreadable } = readAuditLocation(search)
  const filterKey = JSON.stringify(filters)
  const filtered = activeFilterFields(filters).length > 0
  const { query, restart } = useAuditTimeline(filters)

  const pages = query.data?.pages
  const failure = query.isError ? classifyAuditFailure(query.error) : null
  const nextFailed = query.isFetchNextPageError
  // A refusal (403) on a later read means the history can no longer be read here: nothing stale is kept on screen.
  const refused = failure?.kind === 'forbidden'
  const events: readonly AuditEventView[] | undefined = refused ? undefined : pages?.flatMap((page) => page.items)
  const firstPage = refused ? undefined : pages?.[0]
  const restarting = query.isFetching && !query.isFetchingNextPage && !query.isPending
  const nextFailure = nextFailed && !refused ? failure : null
  const stale = query.isRefetchError && !nextFailed && !refused
  const listFailure = events === undefined ? failure : null
  const loading = query.isPending
  const selected = events?.find((event) => event.id === selectedId) ?? events?.[0]
  const showDossier = loading || (events !== undefined && events.length > 0)

  // One live region for what the person did: the count after a first read, a page, a refresh, a selection.
  const [noteState, setNoteState] = useState<{ readonly key: string; readonly text: string } | null>(null)
  const note = noteState?.key === filterKey ? noteState.text : null
  const setNote = (text: string) => setNoteState({ key: filterKey, text })
  const announcement = loading ? t.loading : (note ?? (events !== undefined && pages?.length === 1 ? t.loaded({ count: events.length }) : ''))

  // Focus that waits for the render that holds its target: the first event of a page, or the notice of a failed page.
  const pendingEvent = useRef<string | null>(null)
  const pendingNotice = useRef(false)
  const pendingTitle = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const dossierRef = useRef<HTMLDivElement>(null)
  const focusAfterSelection = useRef(false)
  useEffect(() => {
    if (pendingEvent.current !== null) {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-event-id="${pendingEvent.current}"]`)
      if (row) {
        pendingEvent.current = null
        row.focus()
      }
    }
    if (pendingNotice.current && noticeRef.current) {
      pendingNotice.current = false
      noticeRef.current.focus()
    }
    // The notice that held focus is gone: the heading of the list takes it, never the page body.
    if (pendingTitle.current && noticeRef.current === null) {
      pendingTitle.current = false
      document.getElementById(LIST_TITLE_ID)?.focus()
    }
  }, [events, noteState, nextFailure])
  useEffect(() => {
    if (!focusAfterSelection.current || selected === undefined || dossierRef.current === null) return
    focusAfterSelection.current = false
    dossierRef.current.focus()
    dossierRef.current.scrollIntoView?.({ block: 'start' })
  }, [selected])

  async function loadMore() {
    const result = await query.fetchNextPage()
    if (result.isError) {
      pendingNotice.current = true
      return
    }
    const added = result.data?.pages.at(-1)?.items ?? []
    pendingEvent.current = added[0]?.id ?? null
    setNote(t.loadedMore({ count: added.length }))
  }

  async function restartWalk() {
    const noticeHadFocus = noticeRef.current?.contains(document.activeElement) ?? false
    const result = await restart()
    if (result.isError) return
    pendingTitle.current = noticeHadFocus
    setNote(t.refreshed({ count: result.data?.pages[0]?.items.length ?? 0 }))
  }

  function select(event: AuditEventView, click: MouseEvent<HTMLAnchorElement>) {
    // A modified click opens another tab: nothing changes here.
    if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey || click.button !== 0) return
    setNote(t.selectedStatus({ name: eventLabel(event.eventType, i18n) }))
    // Side by side, focus stays on the row and the live region says what changed; stacked, the dossier is below the fold.
    if (!isStackedLayout()) return
    if (event.id === selected?.id) {
      dossierRef.current?.focus()
      dossierRef.current?.scrollIntoView?.({ block: 'start' })
    } else focusAfterSelection.current = true
  }

  function apply(next: Filters) {
    router.navigate(auditHref(next))
  }

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  const readAt = firstPage?.readAt ?? null
  const clock = readAt === null ? null : format.time(new Date(readAt), LAB_TIME_ZONE)

  return (
    <ManagerShell currentPath={pathOf('audit')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles ag-au-titles">
            <PageHeading className="ag-page__title">{m.shell.sections.audit}</PageHeading>
            <p className="ag-au-lead">{t.lead}</p>
            <p className="ag-au-immutable">
              <span className="ag-readonly">
                <Icon name="lock" />
                {t.immutable}
              </span>
            </p>
          </div>
          {!loading && (
            <div className="ag-au-meta">
              {clock !== null && <span className="ag-au-meta__time">{t.updatedAt({ time: clock })}</span>}
              <Button variant="secondary" size="sm" busy={restarting} onClick={() => !restarting && void restartWalk()}>
                <Icon name="refresh" />
                {t.refresh}
              </Button>
            </div>
          )}
        </header>

        <div className="ag-sr-only" role="status">
          {announcement}
        </div>

        <AuditFilters
          filters={filters}
          unreadable={unreadable}
          refused={failure?.kind === 'invalidFilter' ? refusedFields(failure.fields) : null}
          onApply={apply}
          onRemove={(field: FilterField) => apply({ ...filters, [field]: '' })}
          onClear={() => apply(NO_FILTERS)}
        />

        <div className={showDossier ? 'ag-eq' : 'ag-eq ag-eq--single'}>
          <div className="ag-au-listwrap" ref={listRef}>
            <AuditList
              titleId={LIST_TITLE_ID}
              events={events}
              filters={filters}
              filtered={filtered}
              selectedId={selected?.id ?? null}
              loading={loading}
              failure={listFailure}
              nextFailure={nextFailure}
              stale={stale}
              restarting={restarting}
              readAt={readAt}
              hasMore={query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
              noticeRef={noticeRef}
              onSelect={select}
              onLoadMore={() => void loadMore()}
              onRetryFirst={() => void restartWalk()}
              onRetryNext={() => void loadMore()}
              onRestart={() => void restartWalk()}
              onClearFilters={() => apply(NO_FILTERS)}
            />
          </div>
          {showDossier && <AuditDossier event={loading ? undefined : selected} filters={filters} focusRef={dossierRef} />}
        </div>
      </main>
    </ManagerShell>
  )
}
