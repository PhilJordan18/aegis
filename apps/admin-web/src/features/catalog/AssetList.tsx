import { useId, type MouseEvent } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { diagnosticChip, evaluatedAtLabel, factsLine, reasonLabel } from './assetPresentation'
import { equipmentHref } from './equipmentHref'
import { CatalogAlert } from './CatalogAlert'
import type { CatalogFailure } from './catalogFailure'
import type { AdminAssetPage, AdminAssetView } from './contract'

interface AssetListProps {
  readonly page: AdminAssetPage | undefined
  readonly selectedId: string | null
  readonly loading: boolean
  /** The shown page is the previous one, kept while the requested page loads. */
  readonly refreshing: boolean
  readonly failure: CatalogFailure | null
  /** Set when a refresh failed but a page is still shown. */
  readonly stale: boolean
  readonly onRetry: () => void
  readonly onSelect: (asset: AdminAssetView, event: MouseEvent<HTMLAnchorElement>) => void
  readonly onPage: (page: number) => void
}

export function AssetList({ page, selectedId, loading, refreshing, failure, stale, onRetry, onSelect, onPage }: AssetListProps) {
  const { m } = useI18n()
  const titleId = useId()
  const t = m.equipment
  const items = page?.items ?? []

  return (
    <section className="ag-panel ag-list" aria-labelledby={titleId} aria-busy={loading || refreshing || undefined}>
      <div className="ag-list__head">
        <h2 className="ag-list__title" id={titleId}>
          {page ? t.listTitle({ count: page.totalItems }) : t.unitsTab}
        </h2>
        <span className="ag-list__meta">{t.listMeta}</span>
      </div>

      {failure !== null && page === undefined && (
        <div className="ag-list__alerts">
          <CatalogAlert failure={failure} onRetry={onRetry} />
        </div>
      )}
      {stale && page !== undefined && <StaleBanner page={page} onRetry={onRetry} />}

      {loading && <LoadingRows />}

      {page !== undefined && items.length === 0 && (
        <div className="ag-list__empty">
          <p className="ag-list__empty-title">{t.emptyTitle}</p>
          <p className="ag-list__empty-body">{t.emptyBody}</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="ag-list__items">
          {items.map((asset) => (
            <li key={asset.id}>
              <AssetRow asset={asset} selected={asset.id === selectedId} page={page?.page ?? 0} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      {page !== undefined && page.totalPages > 1 && <Pager page={page} onPage={onPage} />}
      {page !== undefined && items[0] !== undefined && <ListFoot asset={items[0]} />}
    </section>
  )
}

function AssetRow({
  asset,
  selected,
  page,
  onSelect,
}: {
  readonly asset: AdminAssetView
  readonly selected: boolean
  readonly page: number
  readonly onSelect: AssetListProps['onSelect']
}) {
  const i18n = useI18n()
  const chip = diagnosticChip(asset, i18n)
  const firstReason = asset.operationalDiagnostic.reasons[0]
  return (
    <Link className="ag-item" to={equipmentHref({ page, assetId: asset.id })} aria-current={selected ? 'true' : undefined} onClick={(event) => onSelect(asset, event)}>
      <span className="ag-item__chips">
        <StatusChip role={chip.role} icon={chip.icon}>
          {chip.label}
        </StatusChip>
        {asset.archivedAt !== null && (
          <StatusChip role="neutral" icon="status-info">
            {i18n.m.equipment.archived}
          </StatusChip>
        )}
      </span>
      {firstReason !== undefined && <span className="ag-item__reason">{reasonLabel(firstReason, asset, i18n)}</span>}
      <span className="ag-item__name">
        {asset.model.name}
        <span className="ag-item__code">{asset.assetCode}</span>
      </span>
      <span className="ag-item__facts">{factsLine(asset, i18n)}</span>
    </Link>
  )
}

function ListFoot({ asset }: { readonly asset: AdminAssetView }) {
  const i18n = useI18n()
  return <p className="ag-list__foot">{i18n.m.equipment.listFoot({ time: evaluatedAtLabel(asset, i18n) })}</p>
}

function Pager({ page, onPage }: { readonly page: AdminAssetPage; readonly onPage: (page: number) => void }) {
  const { m } = useI18n()
  const first = page.page <= 0
  const last = page.page >= page.totalPages - 1
  return (
    <nav className="ag-pager" aria-label={m.equipment.paginationLabel}>
      <Button variant="secondary" size="sm" inert={first} onClick={() => !first && onPage(page.page - 1)}>
        {m.equipment.previousPage}
      </Button>
      <span className="ag-pager__page">{m.equipment.pageOf({ page: page.page + 1, pages: page.totalPages })}</span>
      <Button variant="secondary" size="sm" inert={last} onClick={() => !last && onPage(page.page + 1)}>
        {m.equipment.nextPage}
      </Button>
    </nav>
  )
}

function StaleBanner({ page, onRetry }: { readonly page: AdminAssetPage; readonly onRetry: () => void }) {
  const i18n = useI18n()
  const { m } = i18n
  const first = page.items[0]
  return (
    <div className="ag-list__alerts">
      <Alert kind="warning" icon="status-offline" title={m.equipment.staleTitle}>
        {first && <p>{m.equipment.staleBody({ time: evaluatedAtLabel(first, i18n) })}</p>}
        <div className="ag-alert__action">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {m.equipment.retry}
          </Button>
        </div>
      </Alert>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="ag-list__items" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div className="ag-skel" key={row}>
          <span className="ag-skel__bar ag-skel__bar--chip" />
          <span className="ag-skel__bar ag-skel__bar--name" />
          <span className="ag-skel__bar ag-skel__bar--facts" />
        </div>
      ))}
    </div>
  )
}
