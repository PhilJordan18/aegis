import { useId } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { CatalogAlert } from './CatalogAlert'
import type { CatalogFailure } from './catalogFailure'
import type { AssetModelPage, AssetModelView } from './contract'

interface ModelListProps {
  readonly page: AssetModelPage | undefined
  readonly loading: boolean
  readonly refreshing: boolean
  readonly failure: CatalogFailure | null
  readonly onRetry: () => void
  readonly onPage: (page: number) => void
  readonly onEdit: (model: AssetModelView) => void
  readonly onArchive: (model: AssetModelView) => void
}

/** Models of the catalog (CAT-01), archived ones included, in the server's order (09 §12.1: name, then id). */
export function ModelList({ page, loading, refreshing, failure, onRetry, onPage, onEdit, onArchive }: ModelListProps) {
  const { m } = useI18n()
  const titleId = useId()
  const t = m.catalogEdit
  const items = page?.items ?? []

  return (
    <section className="ag-panel ag-list ag-models" aria-labelledby={titleId} aria-busy={loading || refreshing || undefined}>
      <div className="ag-list__head">
        <h2 className="ag-list__title" id={titleId} tabIndex={-1}>
          {page ? t.modelsTitle({ count: page.totalItems }) : m.equipment.modelsTab}
        </h2>
        <span className="ag-list__meta">{t.modelsMeta}</span>
      </div>

      {failure !== null && (
        <div className="ag-list__alerts">
          <CatalogAlert failure={failure} onRetry={onRetry} />
        </div>
      )}

      {loading && (
        <div className="ag-list__items" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div className="ag-skel" key={row}>
              <span className="ag-skel__bar ag-skel__bar--name" />
              <span className="ag-skel__bar ag-skel__bar--facts" />
            </div>
          ))}
        </div>
      )}

      {page !== undefined && items.length === 0 && (
        <div className="ag-list__empty">
          <p className="ag-list__empty-title">{t.modelsEmptyTitle}</p>
          <p className="ag-list__empty-body">{t.modelsEmptyBody}</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="ag-list__items">
          {items.map((model) => (
            <li key={model.id}>
              <ModelRow model={model} onEdit={onEdit} onArchive={onArchive} />
            </li>
          ))}
        </ul>
      )}

      {page !== undefined && page.totalPages > 1 && (
        <nav className="ag-pager" aria-label={t.modelsPaginationLabel}>
          <Button variant="secondary" size="sm" inert={page.page <= 0} onClick={() => page.page > 0 && onPage(page.page - 1)}>
            {m.equipment.previousPage}
          </Button>
          <span className="ag-pager__page">{m.equipment.pageOf({ page: page.page + 1, pages: page.totalPages })}</span>
          <Button
            variant="secondary"
            size="sm"
            inert={page.page >= page.totalPages - 1}
            onClick={() => page.page < page.totalPages - 1 && onPage(page.page + 1)}
          >
            {m.equipment.nextPage}
          </Button>
        </nav>
      )}
    </section>
  )
}

function ModelRow({ model, onEdit, onArchive }: { readonly model: AssetModelView } & Pick<ModelListProps, 'onEdit' | 'onArchive'>) {
  const { m } = useI18n()
  const t = m.catalogEdit
  const reference = [model.manufacturer, model.modelNumber].filter((part) => part !== null && part !== '').join(' ')
  const archived = model.archivedAt !== null
  return (
    <div className="ag-item ag-model">
      <div className="ag-model__text">
        {archived && (
          <span className="ag-item__chips">
            <StatusChip role="neutral" icon="status-info">
              {m.equipment.archived}
            </StatusChip>
          </span>
        )}
        <span className="ag-item__name">{model.name}</span>
        <span className="ag-item__facts">
          {[reference, model.defaultCalibrationRequired ? t.defaultCalibrationYes : t.defaultCalibrationNo].filter((part) => part !== '').join(' · ')}
        </span>
        {model.description !== null && model.description !== '' && <span className="ag-model__description">{model.description}</span>}
      </div>
      {/* An archived model no longer changes (09 §12.1): no action is offered. */}
      {!archived && (
        <div className="ag-model__actions" role="group" aria-label={t.modelActions({ name: model.name })}>
          <Button variant="secondary" size="sm" onClick={() => onEdit(model)}>
            {t.edit}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onArchive(model)}>
            {t.archive}
          </Button>
        </div>
      )}
    </div>
  )
}
