import { useId, type MouseEvent } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { StaleNotice } from '../catalog/StaleNotice'
import { AnomalyAlert } from './AnomalyAlert'
import type { AnomalyReadFailure } from './anomalyFailure'
import { anomalyTypeLabel, instantLabel, severityChip, statusChip, whereLine } from './anomalyPresentation'
import type { AnomalyPage, AnomalyView } from './contract'

interface AnomalyListProps {
  readonly page: AnomalyPage | undefined
  readonly selectedId: string | null
  readonly loading: boolean
  /** The shown page is the previous one, kept while the requested page loads. */
  readonly refreshing: boolean
  readonly failure: AnomalyReadFailure | null
  /** Set when a refresh failed but a page is still shown. */
  readonly stale: boolean
  /** A refresh is running. */
  readonly retrying: boolean
  /** When the page on screen was read, as a time of day; null while nothing was read. */
  readonly readAt: string | null
  /** At least one filter is active: an empty page then says so, and offers « Tout afficher ». */
  readonly filtered: boolean
  readonly hrefFor: (anomaly: AnomalyView) => string
  readonly onRetry: () => void
  readonly onSelect: (anomaly: AnomalyView, event: MouseEvent<HTMLAnchorElement>) => void
  readonly onPage: (page: number) => void
  readonly onClearFilters: () => void
}

export function AnomalyList({ page, selectedId, loading, refreshing, failure, stale, retrying, readAt, filtered, hrefFor, onRetry, onSelect, onPage, onClearFilters }: AnomalyListProps) {
  const { m } = useI18n()
  const titleId = useId()
  const t = m.anomalies
  const items = page?.items ?? []

  return (
    <section className="ag-panel ag-list" aria-labelledby={titleId} aria-busy={loading || refreshing || undefined}>
      <div className="ag-list__head">
        {/* Focus target when a successful refresh removes the stale notice that had focus. */}
        <h2 className="ag-list__title" id={titleId} tabIndex={-1}>
          {page ? t.listTitle({ count: page.totalItems }) : t.listTitleBare}
        </h2>
        <span className="ag-list__meta">{t.listMeta}</span>
      </div>

      {failure !== null && page === undefined && (
        <div className="ag-list__alerts">
          <AnomalyAlert failure={failure} onRetry={onRetry} retrying={retrying} />
        </div>
      )}
      {stale && page !== undefined && (
        <div className="ag-list__alerts">
          <StaleNotice
            evaluatedAt={readAt}
            body={readAt === null ? undefined : t.staleBody({ time: readAt })}
            retrying={retrying}
            onRetry={onRetry}
            returnFocus={() => document.getElementById(titleId)?.focus()}
          />
        </div>
      )}

      {loading && <LoadingRows />}

      {page !== undefined && items.length === 0 && (
        <div className="ag-list__empty">
          <p className="ag-list__empty-title">{filtered ? t.emptyFilteredTitle : t.emptyTitle}</p>
          <p className="ag-list__empty-body">{filtered ? t.emptyFilteredBody : t.emptyBody}</p>
          {filtered && (
            <div className="ag-an-empty-action">
              <Button variant="secondary" size="sm" onClick={onClearFilters}>
                {t.filterClear}
              </Button>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className="ag-list__items">
          {items.map((anomaly) => (
            <li key={anomaly.id}>
              <AnomalyRow anomaly={anomaly} selected={anomaly.id === selectedId} href={hrefFor(anomaly)} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      {page !== undefined && page.totalPages > 1 && <Pager page={page} onPage={onPage} />}
      {page !== undefined && items.length > 0 && (
        <p className="ag-list__foot">
          {readAt !== null && t.listFoot({ time: readAt })}
          <span className="ag-an-zone">{t.zoneNote({ zone: LAB_TIME_ZONE })}</span>
        </p>
      )}
    </section>
  )
}

function AnomalyRow({ anomaly, selected, href, onSelect }: { readonly anomaly: AnomalyView; readonly selected: boolean; readonly href: string; readonly onSelect: AnomalyListProps['onSelect'] }) {
  const i18n = useI18n()
  const severity = severityChip(anomaly.severity, i18n)
  const status = statusChip(anomaly.status, i18n)
  return (
    <Link className="ag-item" to={href} aria-current={selected ? 'true' : undefined} onClick={(event) => onSelect(anomaly, event)}>
      <span className="ag-item__chips">
        <StatusChip role={severity.role} icon={severity.icon}>
          {severity.label}
        </StatusChip>
        <StatusChip role={status.role} icon={status.icon}>
          {status.label}
        </StatusChip>
      </span>
      <span className="ag-item__name">{anomalyTypeLabel(anomaly, i18n)}</span>
      <span className="ag-item__facts ag-an-where">{whereLine(anomaly, i18n)}</span>
      <span className="ag-item__facts">{i18n.m.anomalies.detected({ time: instantLabel(anomaly.detectedAt, i18n) })}</span>
    </Link>
  )
}

function Pager({ page, onPage }: { readonly page: AnomalyPage; readonly onPage: (page: number) => void }) {
  const { m } = useI18n()
  const first = page.page <= 0
  const last = page.page >= page.totalPages - 1
  return (
    <nav className="ag-pager" aria-label={m.anomalies.paginationLabel}>
      <Button variant="secondary" size="sm" inert={first} onClick={() => !first && onPage(page.page - 1)}>
        {m.anomalies.previousPage}
      </Button>
      <span className="ag-pager__page">{m.anomalies.pageOf({ page: page.page + 1, pages: page.totalPages })}</span>
      <Button variant="secondary" size="sm" inert={last} onClick={() => !last && onPage(page.page + 1)}>
        {m.anomalies.nextPage}
      </Button>
    </nav>
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
