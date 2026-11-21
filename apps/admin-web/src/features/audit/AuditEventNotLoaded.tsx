import type { MouseEvent, Ref } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { auditHref, type AuditFilters } from './auditFilters'

interface AuditEventNotLoadedProps {
  /** The identifier of the address: shown as sent, so the reader sees what was asked for. */
  readonly requestedId: string
  readonly filters: AuditFilters
  /** A next page can be read: « Charger plus » is offered. Otherwise every event of these filters is already loaded. */
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
  /** Called on an unmodified click of « Afficher le premier événement », before the address drops `evenement`. */
  readonly onShowFirst: (click: MouseEvent<HTMLAnchorElement>) => void
  /** Focus target when the control that had focus leaves (the last page was loaded and the event is still absent). */
  readonly focusRef: Ref<HTMLDivElement>
}

/**
 * Dossier area when `evenement` names an event that the loaded pages do not hold. §19.1 has no read by identifier, so the
 * page cannot fetch it: it says so rather than showing another event as if it were the requested one.
 */
export function AuditEventNotLoaded({ requestedId, filters, canLoadMore, loadingMore, onLoadMore, onShowFirst, focusRef }: AuditEventNotLoadedProps) {
  const { m } = useI18n()
  const t = m.audit
  return (
    <section className="ag-panel ag-dossier" aria-label={t.selectedOverline}>
      <div className="ag-dossier__alert" ref={focusRef} tabIndex={-1}>
        <Alert kind="warning" role="status" icon="status-info" title={t.requestedMissingTitle} code={requestedId} codeLabel={t.requestedMissingIdLabel}>
          <p>{canLoadMore ? t.requestedMissingMore : t.requestedMissingEnd}</p>
          <div className="ag-alert__action ag-au-missing-actions">
            {canLoadMore && (
              <Button variant="secondary" size="sm" busy={loadingMore} onClick={() => !loadingMore && onLoadMore()}>
                {loadingMore ? t.loadingMore : t.loadMore}
              </Button>
            )}
            <Link className="ag-link" to={auditHref(filters)} onClick={onShowFirst}>
              {t.requestedMissingShowFirst}
            </Link>
          </div>
        </Alert>
      </div>
    </section>
  )
}
