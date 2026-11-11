import { useId, type Ref } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { ReadOnlyMark } from '../../ui/ReadOnlyMark'
import { StatusChip } from '../../ui/StatusChip'
import { actorView, eventLabel, fullTimeOf, resultChip, stateLabel, subjectLabel } from './auditPresentation'
import { auditHref, type AuditFilters } from './auditFilters'
import type { AuditEventView } from './contract'

interface AuditDossierProps {
  /** Undefined while the first page loads. */
  readonly event: AuditEventView | undefined
  /** The filters of the screen: the links add to them, they never silently drop one. */
  readonly filters: AuditFilters
  /** Focus target after a selection on a stacked layout. */
  readonly focusRef?: Ref<HTMLDivElement>
}

/**
 * Dossier of one event: everything the contract sends, as sent. Codes (event type, subject type, result, reason,
 * states) are shown here only, beside their label. Nothing is completed: a missing operation, reason, result, detail or
 * piece of evidence is said to be missing (handoff §6, states.md §5).
 */
export function AuditDossier({ event, filters, focusRef }: AuditDossierProps) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.audit
  const titleId = useId()

  if (event === undefined) {
    return (
      <section className="ag-panel ag-dossier" aria-label={t.selectedOverline} aria-busy="true">
        <div className="ag-dossier__skel" aria-hidden="true">
          <span className="ag-skel__bar ag-skel__bar--title" />
          <span className="ag-skel__bar ag-skel__bar--block" />
          <span className="ag-skel__bar ag-skel__bar--facts" />
        </div>
      </section>
    )
  }

  const actor = actorView(event.actor, i18n)
  const chip = resultChip(event.result, i18n)
  const transition = event.fromState !== null && event.toState !== null ? { from: event.fromState, to: event.toState } : null

  return (
    <section className="ag-panel ag-dossier" aria-labelledby={titleId}>
      <div className="ag-dossier__scroll" tabIndex={0} role="group" aria-labelledby={titleId} ref={focusRef}>
        <p className="ag-overline">{t.selectedOverline}</p>
        <h2 className="ag-dossier__title" id={titleId}>
          {eventLabel(event.eventType, i18n)}
        </h2>
        <p className="ag-dossier__sub">{fullTimeOf(event.occurredAt, i18n)}</p>
        <p className="ag-sec-title ag-au-readonly">
          <ReadOnlyMark />
        </p>

        <div className="ag-diag ag-diag--none">
          {chip !== null ? (
            <div className="ag-diag__row">
              <StatusChip role={chip.role} icon={chip.icon} size="lg">
                {chip.label}
              </StatusChip>
            </div>
          ) : (
            <p className="ag-diag__reason">{t.noResult}</p>
          )}
          {transition !== null && (
            <>
              <p className="ag-diag__lead ag-au-codes">
                <code>{transition.from}</code>
                <span className="ag-au-arrow" aria-hidden="true">
                  →
                </span>
                <span className="ag-sr-only"> {t.toState} </span>
                <code>{transition.to}</code>
              </p>
              <p className="ag-diag__note">
                {stateLabel(transition.from, i18n)} → {stateLabel(transition.to, i18n)}
              </p>
            </>
          )}
        </div>

        <section className="ag-au-sec" aria-labelledby={`${titleId}-facts`}>
          <h3 className="ag-overline" id={`${titleId}-facts`}>
            {t.factsTitle}
          </h3>
          <dl className="ag-facts ag-au-facts">
            <div>
              <dt>{t.factTime}</dt>
              <dd className="ag-tnum">{fullTimeOf(event.occurredAt, i18n)}</dd>
            </div>
            <div>
              <dt>{t.factEventType}</dt>
              <dd>
                <code className="ag-au-id">{event.eventType}</code>
              </dd>
            </div>
            <div>
              <dt>{t.factActor}</dt>
              <dd>{actor.name}</dd>
              {actor.kind === 'user' && (
                <dd>
                  <code className="ag-au-id">{actor.id}</code>
                </dd>
              )}
              {actor.kind === 'system' && <dd className="ag-help">{t.actorSystemHelp}</dd>}
              {actor.kind === 'unreadable' && <dd className="ag-help">{t.actorUnreadableHelp}</dd>}
            </div>
            <div>
              <dt>{t.factSubject}</dt>
              <dd>
                {subjectLabel(event.subjectType, i18n)} <code className="ag-au-id">{event.subjectType}</code>
              </dd>
              <dd>
                <code className="ag-au-id">{event.subjectId}</code>
              </dd>
            </div>
            <div>
              <dt>{t.factOperation}</dt>
              <dd>{event.operationId === null ? t.noOperation : <code className="ag-au-id">{event.operationId}</code>}</dd>
            </div>
            <div>
              <dt>{t.factResult}</dt>
              <dd>{event.result === null ? t.noResult : <code className="ag-au-id">{event.result}</code>}</dd>
            </div>
            <div>
              <dt>{t.factReason}</dt>
              <dd>{event.reason === null ? t.noReason : <code className="ag-au-id">{event.reason}</code>}</dd>
            </div>
            <div>
              <dt>{t.factId}</dt>
              <dd>
                <code className="ag-au-id">{event.id}</code>
              </dd>
            </div>
          </dl>
          <ul className="ag-au-links">
            {event.operationId !== null && (
              <li>
                <Link className="ag-link" to={auditHref({ ...filters, operationId: event.operationId })}>
                  {t.filterOnOperation}
                </Link>
              </li>
            )}
            <li>
              <Link className="ag-link" to={auditHref({ ...filters, subjectType: event.subjectType, subjectId: event.subjectId })}>
                {t.filterOnSubject}
              </Link>
            </li>
          </ul>
        </section>

        <section className="ag-au-sec" aria-labelledby={`${titleId}-details`}>
          <h3 className="ag-overline" id={`${titleId}-details`}>
            {t.detailsTitle}
          </h3>
          <p>{event.hasDetails ? t.detailsUnread : t.detailsNone}</p>
        </section>

        <section className="ag-au-sec" aria-labelledby={`${titleId}-evidence`}>
          <h3 className="ag-overline" id={`${titleId}-evidence`}>
            {t.evidenceTitle}
          </h3>
          <p className="ag-au-note">{t.evidenceNote}</p>
        </section>
      </div>
    </section>
  )
}
