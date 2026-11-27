import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { queryKeys } from '../api/queryKeys'
import { Link } from '../app/Link'
import { PageHeading } from '../app/PageHeading'
import { useLocation } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import type { UserProfile } from '../features/auth/contract'
import { useSignOut } from '../features/auth/useSignOut'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { CatalogAlert } from '../features/catalog/CatalogAlert'
import { classifyCatalogFailure } from '../features/catalog/catalogFailure'
import { LIST_QUERY_BASE } from '../features/catalog/contract'
import { useAssetList } from '../features/catalog/useCatalogQueries'
import { lockerIdFromSearch, lockerIdsFromPlacements } from '../features/lockers/knownLockers'
import { LockerStatusPanel } from '../features/lockers/LockerStatusPanel'
import { useScrollable } from '../features/lockers/useScrollable'
import { LAB_TIME_ZONE } from '../features/catalog/assetPresentation'
import { useLockerStatuses } from '../features/overview/useOverviewQueries'
import { HelpButton, HelpPanel } from '../features/pageTools/PageHelp'
import { RefreshControl } from '../features/pageTools/RefreshControl'
import { refetchAll } from '../features/pageTools/refetchAll'
import { usePageHelp } from '../features/pageTools/usePageHelp'
import { useI18n } from '../i18n/useI18n'
import '../app/page.css'
import '../features/catalog/equipment.css'
import '../features/lockers/locker-status.css'

// The same first page as Équipements, from the same definition: both screens share one cached request.
const KNOWN_LOCKERS_QUERY = { ...LIST_QUERY_BASE, page: 0 } as const

/**
 * Protected Casiers page (PHY-01 #29), read only: the status of each locker as the server evaluated it.
 * The locker comes from the address (`?casier=`) or, failing that, from the placements of the catalog;
 * there is no list-of-lockers route in P0.
 */
export function LockersPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const { m } = useI18n()
  const { search } = useLocation()
  const currentProfile = useCurrentAdminProfile()
  const profile = currentProfile.data ?? sessionProfile

  const named = lockerIdFromSearch(search)
  const catalog = useAssetList(KNOWN_LOCKERS_QUERY, { enabled: named === null })
  const lockerIds = named !== null ? [named] : lockerIdsFromPlacements(catalog.data?.items ?? [])
  const catalogFailure = named === null && catalog.isError && catalog.data === undefined ? classifyCatalogFailure(catalog.error) : null
  const searching = named === null && catalog.isPending
  // The list of panels scrolls on its own on a wide screen: it is a tab stop only while it does.
  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>(lockerIds.join())
  // The retry button of the catalog alert leaves the page while the request runs: the page takes focus, never the body.
  const mainRef = useRef<HTMLElement>(null)
  function retryCatalog() {
    mainRef.current?.focus()
    void catalog.refetch()
  }

  const statuses = useLockerStatuses(lockerIds)
  const client = useQueryClient()
  const help = usePageHelp('lockers')
  const read = statuses.filter((status) => status.data !== undefined)
  // The oldest locker read shown: the page is as fresh as its least fresh panel.
  const readAt = read.length === 0 || read.length < statuses.length ? null : Math.min(...read.map((status) => status.dataUpdatedAt))
  const refresh = () =>
    refetchAll(client, [
      { queryKey: [...queryKeys.lockers.all, 'status'], type: 'active' },
      { queryKey: queryKeys.custody.all, type: 'active' },
      ...(named === null ? [{ queryKey: queryKeys.catalog.all, type: 'active' as const }] : []),
    ])

  const signOut = useSignOut()

  return (
    <ManagerShell currentPath={pathOf('lockers')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1} ref={mainRef}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{m.lockers.heading}</PageHeading>
          </div>
          <div className="ag-page__actions">
            <HelpButton help={help} />
            <RefreshControl onRefresh={refresh} readAt={readAt} stale={statuses.some((status) => status.isRefetchError)} />
          </div>
        </header>

        <HelpPanel help={help}>
          <p>{m.pageTools.labHours({ zone: LAB_TIME_ZONE })}</p>
        </HelpPanel>

        {searching && (
          <section className="ag-panel ag-lk" aria-label={m.lockers.statusLabel} aria-busy="true">
            <p className="ag-sr-only" role="status">
              {m.lockers.loadingLockers}
            </p>
            <div className="ag-lk__skel" aria-hidden="true">
              <span className="ag-skel__bar ag-skel__bar--title" />
              <span className="ag-skel__bar ag-skel__bar--block" />
              <span className="ag-skel__bar ag-skel__bar--facts" />
            </div>
          </section>
        )}

        {catalogFailure !== null && (
          <div className="ag-lk__alert">
            <CatalogAlert failure={catalogFailure} onRetry={retryCatalog} />
          </div>
        )}

        {!searching && catalogFailure === null && lockerIds.length === 0 && (
          <section className="ag-panel ag-lk" aria-label={m.lockers.statusLabel}>
            <div className="ag-list__empty">
              <p className="ag-list__empty-title">{m.lockers.emptyTitle}</p>
              <p className="ag-list__empty-body">{m.lockers.emptyBody}</p>
              <p className="ag-lk__empty-action">
                <Link className="ag-link" to={pathOf('equipment')}>
                  {m.lockers.emptyAction}
                </Link>
              </p>
            </div>
          </section>
        )}

        {lockerIds.length > 0 && (
          <div className="ag-lockers" ref={scrollRef} tabIndex={scrollable ? 0 : undefined} role={scrollable ? 'group' : undefined} aria-label={scrollable ? m.lockers.heading : undefined}>
            {lockerIds.map((lockerId) => (
              <LockerStatusPanel key={lockerId} lockerId={lockerId} />
            ))}
          </div>
        )}
      </main>
    </ManagerShell>
  )
}
