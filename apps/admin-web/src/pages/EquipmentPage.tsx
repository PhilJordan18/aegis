import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { PageHeading } from '../app/PageHeading'
import { useLocation, useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import { Link } from '../app/Link'
import type { UserProfile } from '../features/auth/contract'
import { useSessionStore } from '../features/auth/session'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { assetName } from '../features/catalog/assetPresentation'
import { AssetDossier } from '../features/catalog/AssetDossier'
import { AssetList } from '../features/catalog/AssetList'
import { equipmentHref } from '../features/catalog/equipmentHref'
import { classifyCatalogFailure } from '../features/catalog/catalogFailure'
import { DEFAULT_PAGE_SIZE, type AdminAssetView, type AssetListQuery } from '../features/catalog/contract'
import { useAsset, useAssetList } from '../features/catalog/useCatalogQueries'
import { useI18n } from '../i18n/useI18n'
import '../app/page.css'
import '../features/catalog/equipment.css'

const LIST_QUERY_BASE = { size: DEFAULT_PAGE_SIZE, sort: 'assetCode,asc' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The API reads `page` as a Java int (PageQuery): a larger index is a 400, not a page past the end. */
const MAX_PAGE_INDEX = 2_147_483_647

/** `?page=2&exemplaire=<id>`: the page is one-based in the address, zero-based in the API. An unusable value is ignored. */
function readLocation(search: string): { page: number; assetId: string | null } {
  const params = new URLSearchParams(search)
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const assetId = params.get('exemplaire')
  return {
    page: Number.isInteger(page) && page >= 1 && page - 1 <= MAX_PAGE_INDEX ? page - 1 : 0,
    assetId: assetId !== null && UUID.test(assetId) ? assetId.toLowerCase() : null,
  }
}

/** The dossier sits under the list below 1024 px, out of sight after a selection (handoff §5). */
function isStackedLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches
}

function revealDossier(target: HTMLElement | null) {
  target?.focus()
  target?.scrollIntoView?.({ block: 'start' })
}

/**
 * Protected Équipements page (CAT-01, read-only): the units of the administrator catalog and the
 * selected unit's dossier, both from the real API. Mutations and forms are not part of this slice.
 */
export function EquipmentPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const { m } = useI18n()
  const sessionStore = useSessionStore()
  const router = useRouter()
  const { search } = useLocation()
  const currentProfile = useCurrentAdminProfile()
  // The login response already carries the profile (states.md §1); /auth/me refreshes it.
  const profile = currentProfile.data ?? sessionProfile

  const location = readLocation(search)
  const query: AssetListQuery = { ...LIST_QUERY_BASE, page: location.page }
  const list = useAssetList(query)
  const page = list.data

  // A page past the end (a stale bookmark, a shrunk catalog) goes back to the last one that exists.
  const lastPage = page !== undefined && !list.isPlaceholderData ? Math.max(page.totalPages - 1, 0) : null
  useEffect(() => {
    if (lastPage !== null && location.page > lastPage) router.navigate(equipmentHref({ page: lastPage, assetId: null }), { replace: true })
  }, [lastPage, location.page, router])

  const items = page?.items ?? []
  const selectedId = location.assetId ?? items[0]?.id ?? null
  const listed = items.find((asset) => asset.id === selectedId)
  const asset = useAsset(selectedId, listed)

  const [selectionNote, setSelectionNote] = useState('')
  const focusAfterSelection = useRef(false)
  const dossierRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusAfterSelection.current || selectedId === null) return
    if (dossierRef.current === null) return
    focusAfterSelection.current = false
    revealDossier(dossierRef.current)
  }, [selectedId, asset.data])

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  function select(selected: AdminAssetView, event: MouseEvent<HTMLAnchorElement>) {
    // A modified click opens another tab: nothing changes here.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    setSelectionNote(m.equipment.selectedStatus({ name: assetName(selected) }))
    // Side by side, focus stays on the row and the live region says what changed; stacked, the dossier is below the fold.
    if (!isStackedLayout()) return
    if (selected.id === selectedId) revealDossier(dossierRef.current)
    else focusAfterSelection.current = true
  }

  const listFailure = list.isError ? classifyCatalogFailure(list.error) : null
  const assetFailure = asset.isError ? classifyCatalogFailure(asset.error) : null
  // A refresh the server refuses (403, 404) does not leave stale data: the unit can no longer be read.
  const assetGone = asset.isRefetchError && (assetFailure?.kind === 'forbidden' || assetFailure?.kind === 'notFound')
  const listAnnouncement = list.isPending
    ? m.equipment.loading
    : page !== undefined && !list.isPlaceholderData
      ? m.equipment.loaded({ count: page.totalItems, page: page.page + 1, pages: Math.max(page.totalPages, 1) })
      : ''

  const empty = page !== undefined && page.totalItems === 0
  const showDossier = !empty && !(list.isError && page === undefined)

  return (
    <ManagerShell currentPath={pathOf('equipment')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{m.equipment.heading}</PageHeading>
            <nav className="ag-tabs" aria-label={m.equipment.viewsLabel}>
              <Link className="ag-tabs__tab" to={pathOf('equipment')} aria-current="page">
                {m.equipment.unitsTab}
              </Link>
              <span className="ag-tabs__tab" aria-disabled="true">
                {m.equipment.modelsTab}
                <span className="ag-sr-only">{m.shell.soonSuffix}</span>
                <span className="ag-soon" aria-hidden="true" />
              </span>
            </nav>
          </div>
        </header>

        <div className="ag-sr-only" role="status">
          {listAnnouncement}
        </div>
        <div className="ag-sr-only" role="status">
          {selectionNote}
        </div>

        <div className={showDossier ? 'ag-eq' : 'ag-eq ag-eq--single'}>
          <AssetList
            page={page}
            selectedId={selectedId}
            loading={list.isPending}
            refreshing={list.isPlaceholderData}
            failure={listFailure}
            stale={list.isRefetchError}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
            onSelect={select}
            onPage={(next) => router.navigate(equipmentHref({ page: next, assetId: null }))}
          />
          {showDossier && (
            <AssetDossier
              asset={assetGone ? undefined : asset.data}
              loading={asset.isPending || list.isPending}
              failure={assetFailure}
              stale={asset.isRefetchError && !assetGone}
              retrying={asset.isFetching}
              focusRef={dossierRef}
              onRetry={() => void asset.refetch()}
              onBack={() => router.navigate(equipmentHref({ page: location.page, assetId: null }))}
            />
          )}
        </div>
      </main>
    </ManagerShell>
  )
}
