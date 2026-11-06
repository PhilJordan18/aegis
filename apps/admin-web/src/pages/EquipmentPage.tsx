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
import { AssetSearch } from '../features/catalog/AssetSearch'
import { equipmentHref, modelsHref } from '../features/catalog/equipmentHref'
import { readSearchText } from '../features/catalog/searchText'
import { classifyCatalogFailure } from '../features/catalog/catalogFailure'
import { LIST_QUERY_BASE, type AdminAssetView, type AssetListQuery, type AssetModelView } from '../features/catalog/contract'
import { ArchiveDialog } from '../features/catalog/forms/ArchiveDialog'
import { CustodySection } from '../features/custody/CustodySection'
import { AssetFormDialog } from '../features/catalog/forms/AssetFormDialog'
import { ModelFormDialog } from '../features/catalog/forms/ModelFormDialog'
import { ModelList } from '../features/catalog/ModelList'
import { useCatalogMutations } from '../features/catalog/useCatalogMutations'
import { useAsset, useAssetList, useModelList } from '../features/catalog/useCatalogQueries'
import { useI18n } from '../i18n/useI18n'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import '../app/page.css'
import '../features/catalog/equipment.css'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The API reads `page` as a Java int (PageQuery): a larger index is a 400, not a page past the end. */
const MAX_PAGE_INDEX = 2_147_483_647

const MODEL_PAGE_SIZE = 20

/**
 * `?page=2&exemplaire=<id>`, or `?vue=modeles&page=2`: the page is one-based in the address, zero-based in the API.
 * An unusable value is ignored.
 */
function readLocation(search: string): { view: 'units' | 'models'; page: number; assetId: string | null; search: string | null } {
  const params = new URLSearchParams(search)
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const assetId = params.get('exemplaire')
  return {
    view: params.get('vue') === 'modeles' ? 'models' : 'units',
    page: Number.isInteger(page) && page >= 1 && page - 1 <= MAX_PAGE_INDEX ? page - 1 : 0,
    assetId: assetId !== null && UUID.test(assetId) ? assetId.toLowerCase() : null,
    search: params.get('recherche'),
  }
}

/** One open dialog at a time; `session` remounts it, so each opening starts from a fresh draft and idempotency key. */
type EditIntent =
  | { readonly kind: 'createAsset' | 'createModel' }
  | { readonly kind: 'editAsset' | 'archiveAsset'; readonly asset: AdminAssetView }
  | { readonly kind: 'editModel' | 'archiveModel'; readonly model: AssetModelView }
// A closed session keeps its key: the dialog stays mounted with `open=false`, so it can give focus back to its opener.
type Editing = EditIntent & { readonly session: number; readonly open: boolean }

/** The dossier sits under the list below 1024 px, out of sight after a selection (handoff §5). */
function isStackedLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches
}

function revealDossier(target: HTMLElement | null) {
  target?.focus()
  target?.scrollIntoView?.({ block: 'start' })
}

/**
 * Protected Équipements page (CAT-01): the units and the models of the administrator catalog, from the real API,
 * with their creation, modification and archive. The server decides every rule; the forms only anticipate the
 * single-field ones. The forms follow the direction
 * approved for P0 on 6 November 2026 (docs/design/manager-forms/README.md).
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
  const modelsView = location.view === 'models'
  // Only a valid search filters (09 §22.3); an unusable one in the address filters nothing and the field says why.
  const searchRead = location.search === null ? null : readSearchText(location.search)
  const activeSearch = searchRead?.kind === 'valid' ? searchRead.q : null
  const query: AssetListQuery = { ...LIST_QUERY_BASE, page: modelsView ? 0 : location.page, ...(activeSearch === null ? {} : { q: activeSearch }) }
  const list = useAssetList(query, { enabled: !modelsView })
  const page = list.data
  const models = useModelList({ page: modelsView ? location.page : 0, size: MODEL_PAGE_SIZE }, { enabled: modelsView })
  const { archiveAsset, archiveModel } = useCatalogMutations()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [outcome, setOutcome] = useState('')
  const sessions = useRef(0)
  const open = (next: EditIntent) => {
    sessions.current += 1
    setOutcome('')
    setEditing({ ...next, session: sessions.current, open: true })
  }
  const close = () => setEditing((current) => (current === null ? null : { ...current, open: false }))

  // A page past the end (a stale bookmark, a shrunk catalog, an archive on the last page) goes back to the last one.
  const lastPage = page !== undefined && !list.isPlaceholderData ? Math.max(page.totalPages - 1, 0) : null
  const lastModelPage = models.data !== undefined && !models.isPlaceholderData ? Math.max(models.data.totalPages - 1, 0) : null
  useEffect(() => {
    if (modelsView) {
      if (lastModelPage !== null && location.page > lastModelPage) router.navigate(modelsHref({ page: lastModelPage }), { replace: true })
    } else if (lastPage !== null && location.page > lastPage) router.navigate(equipmentHref({ page: lastPage, assetId: null, search: activeSearch }), { replace: true })
  }, [modelsView, lastPage, lastModelPage, location.page, router, activeSearch])

  const items = modelsView ? [] : (page?.items ?? [])
  const selectedId = modelsView ? null : location.assetId ?? items[0]?.id ?? null
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
  // A refresh the server refuses (403, 404) does not leave stale data: the units can no longer be read. A 403 on the
  // catalog does not end the session (only /auth/me does), so the page shows the refusal itself.
  const listGone = list.isRefetchError && listFailure?.kind === 'forbidden'
  const assetGone = asset.isRefetchError && (assetFailure?.kind === 'forbidden' || assetFailure?.kind === 'notFound')
  const shownPage = listGone ? undefined : page
  const listAnnouncement = list.isPending
    ? m.equipment.loading
    : page !== undefined && !list.isPlaceholderData
      ? m.equipment.loaded({ count: page.totalItems, page: page.page + 1, pages: Math.max(page.totalPages, 1) })
      : ''

  const empty = page !== undefined && page.totalItems === 0
  const showDossier = !empty && !(list.isError && shownPage === undefined)

  const modelFailure = models.isError ? classifyCatalogFailure(models.error) : null
  const modelPage = models.isError && modelFailure?.kind === 'forbidden' ? undefined : models.data
  const modelAnnouncement = !modelsView
    ? ''
    : models.isPending
      ? m.catalogEdit.modelsListLoading
      : modelPage !== undefined && !models.isPlaceholderData
        ? m.catalogEdit.modelsLoaded({ count: modelPage.totalItems })
        : ''

  function savedAsset(saved: AdminAssetView, created: boolean) {
    close()
    setOutcome(created ? m.catalogEdit.assetCreated({ code: saved.assetCode }) : m.catalogEdit.assetSaved({ code: saved.assetCode }))
    // A new unit is shown at once; its list page is unknown (the order is the server's), so the list restarts at the first.
    if (created) router.navigate(equipmentHref({ page: 0, assetId: saved.id }))
  }

  function savedModel(saved: AssetModelView, created: boolean) {
    close()
    setOutcome(created ? m.catalogEdit.modelCreated({ name: saved.name }) : m.catalogEdit.modelSaved({ name: saved.name }))
  }

  const t = m.catalogEdit
  const dossierActions =
    asset.data !== undefined && asset.data.archivedAt === null ? (
      <>
        <Button variant="secondary" size="sm" onClick={() => asset.data && open({ kind: 'editAsset', asset: asset.data })}>
          {t.edit}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => asset.data && open({ kind: 'archiveAsset', asset: asset.data })}>
          {t.archive}
        </Button>
      </>
    ) : undefined

  return (
    <ManagerShell currentPath={pathOf('equipment')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{m.equipment.heading}</PageHeading>
            <nav className="ag-tabs" aria-label={m.equipment.viewsLabel}>
              <Link className="ag-tabs__tab" to={equipmentHref({ page: 0, assetId: null })} aria-current={modelsView ? undefined : 'page'}>
                {m.equipment.unitsTab}
              </Link>
              <Link className="ag-tabs__tab" to={modelsHref({ page: 0 })} aria-current={modelsView ? 'page' : undefined}>
                {m.equipment.modelsTab}
              </Link>
            </nav>
          </div>
          <div className="ag-page__actions">
            <Button onClick={() => open({ kind: modelsView ? 'createModel' : 'createAsset' })}>
              <Icon name="plus" />
              {modelsView ? t.newModel : t.newAsset}
            </Button>
          </div>
        </header>

        <div className="ag-sr-only" role="status">
          {modelsView ? modelAnnouncement : listAnnouncement}
        </div>
        <div className="ag-sr-only" role="status">
          {selectionNote}
        </div>
        <div className="ag-sr-only" role="status">
          {outcome}
        </div>

        {!modelsView && (
          <AssetSearch
            key={location.search ?? ''}
            value={location.search}
            onSearch={(next) => router.navigate(equipmentHref({ page: 0, assetId: null, search: next }))}
          />
        )}

        {modelsView ? (
          <div className="ag-eq ag-eq--single">
            <ModelList
              page={modelPage}
              loading={models.isPending}
              refreshing={models.isPlaceholderData}
              failure={modelPage === undefined ? modelFailure : null}
              onRetry={() => void models.refetch()}
              onPage={(next) => router.navigate(modelsHref({ page: next }))}
              onEdit={(model) => open({ kind: 'editModel', model })}
              onArchive={(model) => open({ kind: 'archiveModel', model })}
            />
          </div>
        ) : (
          <div className={showDossier ? 'ag-eq' : 'ag-eq ag-eq--single'}>
            <AssetList
              page={shownPage}
              selectedId={selectedId}
              loading={list.isPending}
              refreshing={list.isPlaceholderData}
              failure={listFailure}
              stale={list.isRefetchError && !listGone}
              retrying={list.isFetching}
              onRetry={() => void list.refetch()}
              onSelect={select}
              onPage={(next) => router.navigate(equipmentHref({ page: next, assetId: null, search: activeSearch }))}
              search={activeSearch}
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
                onBack={() => router.navigate(equipmentHref({ page: location.page, assetId: null, search: activeSearch }))}
                actions={dossierActions}
                custody={
                  asset.data !== undefined && !assetGone ? (
                    <CustodySection
                      key={asset.data.id}
                      asset={asset.data}
                      onOutcome={(message) => {
                        setOutcome('')
                        requestAnimationFrame(() => setOutcome(message))
                      }}
                    />
                  ) : undefined
                }
              />
            )}
          </div>
        )}
      </main>

      <AssetFormDialog
        key={`asset-${editing?.session ?? 0}`}
        open={editing?.open === true && (editing.kind === 'createAsset' || editing.kind === 'editAsset')}
        asset={editing?.kind === 'editAsset' ? editing.asset : null}
        onClose={close}
        onSaved={savedAsset}
      />
      <ModelFormDialog
        key={`model-${editing?.session ?? 0}`}
        open={editing?.open === true && (editing.kind === 'createModel' || editing.kind === 'editModel')}
        model={editing?.kind === 'editModel' ? editing.model : null}
        onClose={close}
        onSaved={savedModel}
      />
      <ArchiveDialog
        key={`archive-${editing?.session ?? 0}`}
        open={editing?.open === true && (editing.kind === 'archiveAsset' || editing.kind === 'archiveModel')}
        title={
          editing?.kind === 'archiveAsset'
            ? t.archiveAssetTitle({ code: editing.asset.assetCode })
            : editing?.kind === 'archiveModel'
              ? t.archiveModelTitle({ name: editing.model.name })
              : ''
        }
        consequence={editing?.kind === 'archiveModel' ? t.archiveModelBody : t.archiveAssetBody}
        guard={editing?.kind === 'archiveModel' ? t.archiveModelGuard : t.archiveAssetGuard}
        archive={(idempotencyKey) =>
          editing?.kind === 'archiveModel'
            ? archiveModel.mutateAsync({ modelId: editing.model.id, idempotencyKey }).then((model) => t.modelArchived({ name: model.name }))
            : editing?.kind === 'archiveAsset'
              ? archiveAsset.mutateAsync({ assetId: editing.asset.id, idempotencyKey }).then((archived) => t.assetArchived({ code: archived.assetCode }))
              : Promise.reject(new Error('No archive target'))
        }
        onClose={close}
        onArchived={(message) => {
          close()
          setOutcome(message)
        }}
      />
    </ManagerShell>
  )
}
