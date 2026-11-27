import type { MouseEvent, Ref } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { StaleNotice } from '../catalog/StaleNotice'
import { AuditAlert } from './AuditAlert'
import type { AuditFailure } from './auditFailure'
import { auditHref, type AuditFilters } from './auditFilters'
import { actorView, clockOf, eventLabel, groupByDay, resultChip, stateLabel } from './auditPresentation'
import { SubjectName } from './SubjectName'
import { useLabelIndex } from '../labels/useLabelIndex'
import '../pageTools/data-table.css'
import { useRecordsLayout } from '../pageTools/useRecordsLayout'
import type { AuditEventView } from './contract'

interface AuditListProps {
  /** Id of the list heading: the page moves focus there when the control that had it has left. */
  readonly titleId: string
  /** Undefined until a page has been read, or when the server refused further reads (403). */
  readonly events: readonly AuditEventView[] | undefined
  readonly filters: AuditFilters
  readonly filtered: boolean
  readonly selectedId: string | null
  readonly loading: boolean
  /** Why the history could not be read at all; null when events are shown. */
  readonly failure: AuditFailure | null
  /** Why the next page could not be read; the events already loaded stay on screen. */
  readonly nextFailure: AuditFailure | null
  /** A refresh failed but the earlier events are still shown. */
  readonly stale: boolean
  /** A refresh or a restart is running. */
  readonly restarting: boolean
  readonly readAt: number | null
  readonly hasMore: boolean
  readonly loadingMore: boolean
  /** Focus target for the notice that replaces « Charger plus » when the next page fails. */
  readonly noticeRef: Ref<HTMLDivElement>
  readonly onSelect: (event: AuditEventView, click: MouseEvent<HTMLAnchorElement>) => void
  readonly onLoadMore: () => void
  readonly onRetryFirst: () => void
  readonly onRetryNext: () => void
  readonly onRestart: () => void
  readonly onClearFilters: () => void
}

/**
 * The timeline: events grouped by laboratory day, newest first as the server sends them (D1). The count is what was loaded,
 * never a total (the contract has none). Each failure has its own place: the whole read at the top of the panel, the
 * next page under the events, a failed refresh as a stale notice above them.
 */
export function AuditList(props: AuditListProps) {
  const i18n = useI18n()
  const { m, format } = i18n
  const t = m.audit
  const { titleId, events, filters, filtered, selectedId, loading, failure, nextFailure, stale, restarting, readAt, hasMore, loadingMore, noticeRef } = props
  const shown = events ?? []
  const readTime = readAt === null ? null : format.time(new Date(readAt), LAB_TIME_ZONE)
  const layout = useRecordsLayout()
  const wide = layout === 'wide'

  return (
    <section className="ag-panel ag-list" aria-labelledby={titleId} aria-busy={loading || restarting || undefined}>
      <div className="ag-list__head">
        {/* Focus target when a successful refresh removes the stale notice that had focus. */}
        <h2 className="ag-list__title" id={titleId} tabIndex={-1}>
          {events === undefined ? m.shell.sections.audit : t.listTitle({ count: shown.length })}
        </h2>
        <span className="ag-list__meta">
          {t.listMeta} · {t.listOrder}
        </span>
      </div>

      {failure !== null && events === undefined && (
        <div className="ag-list__alerts">
          <AuditAlert failure={failure} scope="list" onRetry={props.onRetryFirst} onRestart={props.onRestart} restarting={restarting} />
        </div>
      )}
      {stale && events !== undefined && (
        <div className="ag-list__alerts">
          <StaleNotice
            evaluatedAt={readTime}
            retrying={restarting}
            onRetry={props.onRestart}
            returnFocus={() => document.getElementById(titleId)?.focus()}
            body={(time) => t.staleBody({ time })}
          />
        </div>
      )}

      {loading && (
        <div className="ag-list__items" aria-hidden="true">
          {[0, 1, 2, 3].map((row) => (
            <div className="ag-skel" key={row}>
              <span className="ag-skel__bar ag-skel__bar--chip" />
              <span className="ag-skel__bar ag-skel__bar--name" />
              <span className="ag-skel__bar ag-skel__bar--facts" />
            </div>
          ))}
        </div>
      )}
      {loading && (
        <p className="ag-sr-only" role="status">
          {t.loading}
        </p>
      )}

      {events !== undefined && shown.length === 0 && (
        <div className="ag-list__empty">
          <p className="ag-list__empty-title">{filtered ? t.emptyFilteredTitle : t.emptyTitle}</p>
          <p className="ag-list__empty-body">{filtered ? t.emptyFilteredBody : t.emptyBody}</p>
          {filtered && (
            <p className="ag-au-empty-action">
              <Button variant="secondary" size="sm" onClick={props.onClearFilters}>
                {m.pageTools.clearFilters}
              </Button>
            </p>
          )}
        </div>
      )}

      {shown.length > 0 && layout !== 'cards' && (
        // Design §8.2: a fixed table grouped by laboratory day, newest first as the server sends it; no column sort.
        <div className="ag-list__items ag-tbl-wrap">
          <table className="ag-tbl ag-au-table">
            <caption className="ag-sr-only">{m.shell.sections.audit}</caption>
            <thead>
              <tr>
                <th scope="col" className="ag-tbl__col--time">
                  {t.colTime}
                </th>
                <th scope="col">{t.colEvent}</th>
                {wide && <th scope="col">{t.colActor}</th>}
                <th scope="col">{t.colSubject}</th>
                {wide && <th scope="col">{t.colTransition}</th>}
              </tr>
            </thead>
            {groupByDay(shown, i18n).map((group) => (
              <tbody key={group.day}>
                <tr className="ag-au-dayrow">
                  <th scope="colgroup" colSpan={wide ? 5 : 3} className="ag-au-day" id={`${titleId}-${group.day}`}>
                    {group.heading}
                  </th>
                </tr>
                {group.events.map((event) => (
                  <EventRow key={event.id} event={event} wide={wide} filters={filters} selected={event.id === selectedId} onSelect={props.onSelect} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {shown.length > 0 && layout === 'cards' && (
        // Design §8.3: below 1280 px, card rows under each laboratory day.
        <div className="ag-list__items ag-au-cards">
          {groupByDay(shown, i18n).map((group) => (
            <section key={group.day} aria-labelledby={`${titleId}-${group.day}`}>
              <h3 className="ag-au-day" id={`${titleId}-${group.day}`}>
                {group.heading}
              </h3>
              <ul className="ag-au-cards__list">
                {group.events.map((event) => (
                  <li key={event.id}>
                    <EventCard event={event} filters={filters} selected={event.id === selectedId} onSelect={props.onSelect} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="ag-au-more">
          {nextFailure !== null && (
            <div className="ag-au-more__alert" ref={noticeRef} tabIndex={-1}>
              <AuditAlert failure={nextFailure} scope="next" onRetry={props.onRetryNext} onRestart={props.onRestart} restarting={restarting} />
            </div>
          )}
          {nextFailure === null && hasMore && (
            <div className="ag-au-more__row">
              <Button variant="secondary" size="sm" busy={loadingMore} onClick={() => !loadingMore && props.onLoadMore()}>
                {loadingMore ? t.loadingMore : t.loadMore}
              </Button>
              <span className="ag-au-more__text">{t.moreExist}</span>
            </div>
          )}
          {nextFailure === null && !hasMore && <p className="ag-au-more__text ag-au-more__end">{t.endReached}</p>}
        </div>
      )}

      {shown.length > 0 && (
        <p className="ag-list__foot">
          {readTime !== null && <span>{t.listFoot({ time: readTime })}</span>}
          <span className="ag-au-zone">{t.refreshNote}</span>
          <span className="ag-au-zone">{m.equipment.zoneNote({ zone: LAB_TIME_ZONE })}</span>
        </p>
      )}
    </section>
  )
}

function EventRow({
  event,
  wide,
  filters,
  selected,
  onSelect,
}: {
  readonly event: AuditEventView
  readonly wide: boolean
  readonly filters: AuditFilters
  readonly selected: boolean
  readonly onSelect: AuditListProps['onSelect']
}) {
  const i18n = useI18n()
  const t = i18n.m.audit
  const actor = actorView(event.actor, i18n)
  const labels = useLabelIndex()
  const chip = event.result === 'ACCEPTED' ? null : resultChip(event.result, i18n)
  return (
    <tr
      className="ag-tbl__row ag-au-ev"
      aria-current={selected ? 'true' : undefined}
      onClick={(click) => {
        // The link answers its own clicks; elsewhere the row follows it, a modified click opening a new tab.
        if ((click.target as HTMLElement).closest('a') !== null) return
        const link = click.currentTarget.querySelector<HTMLAnchorElement>('a.ag-tbl__link')
        if (link === null) return
        if (click.metaKey || click.ctrlKey || click.shiftKey) window.open(link.href, '_blank', 'noopener')
        else {
          link.focus()
          link.click()
        }
      }}
    >
      <td className="ag-au-ev__time">
        {clockOf(event.occurredAt, i18n)}
      </td>
      <td>
        <Link className="ag-tbl__link ag-au-ev__name" to={auditHref(filters, event.id)} aria-current={selected ? 'true' : undefined} data-event-id={event.id} onClick={(click) => onSelect(event, click)}>
          <span>{eventLabel(event.eventType, i18n)}</span>
        </Link>
        {chip !== null && (
          <StatusChip role={chip.role} icon={chip.icon}>
            {chip.label}
          </StatusChip>
        )}
      </td>
      {wide && <td>{actor.name}</td>}
      <td>
        <SubjectName subjectType={event.subjectType} subjectId={event.subjectId} labels={labels} />
      </td>
      {wide && (
        <td>
          {event.fromState !== null && event.toState !== null ? (
            <>
              {stateLabel(event.fromState, i18n)}
              <span className="ag-au-arrow" aria-hidden="true">
                {' → '}
              </span>
              <span className="ag-sr-only"> {t.toState} </span>
              {stateLabel(event.toState, i18n)}
            </>
          ) : (
            <span className="ag-tbl__sub">{t.noTransition}</span>
          )}
        </td>
      )}
    </tr>
  )
}

/** One audit event as a card row (Design §8.3): result chip when not accepted, the event, then time · subject. */
function EventCard({ event, filters, selected, onSelect }: { readonly event: AuditEventView; readonly filters: AuditFilters; readonly selected: boolean; readonly onSelect: AuditListProps['onSelect'] }) {
  const i18n = useI18n()
  const labels = useLabelIndex()
  const chip = event.result === 'ACCEPTED' ? null : resultChip(event.result, i18n)
  return (
    <Link className="ag-item ag-au-card" to={auditHref(filters, event.id)} aria-current={selected ? 'true' : undefined} data-event-id={event.id} onClick={(click) => onSelect(event, click)}>
      {chip !== null && (
        <span className="ag-item__chips">
          <StatusChip role={chip.role} icon={chip.icon}>
            {chip.label}
          </StatusChip>
        </span>
      )}
      <span className="ag-item__name">{eventLabel(event.eventType, i18n)}</span>
      <span className="ag-item__facts">
        {clockOf(event.occurredAt, i18n)}
        {' · '}
        <SubjectName subjectType={event.subjectType} subjectId={event.subjectId} labels={labels} />
      </span>
    </Link>
  )
}
