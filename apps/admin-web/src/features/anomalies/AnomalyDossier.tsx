import { useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { StaleNotice } from '../catalog/StaleNotice'
import { UNRECOGNIZED } from '../catalog/contract'
import { AnomalyAlert } from './AnomalyAlert'
import type { AnomalyReadFailure } from './anomalyFailure'
import { anomalyTypeLabel, hasUnrecognizedValue, instantLabel, severityChip, statusChip, whereLine } from './anomalyPresentation'
import { EVIDENCE_LIMIT, type AnomalyDetail, type AnomalyEvidence, type AnomalyView } from './contract'

/** What the page tells the dossier happened to this anomaly in this session; never inferred from the data. */
export type DossierOutcome = 'acknowledged' | 'resolvedMeanwhile'

interface AnomalyDossierProps {
  /** The anomaly to show: the detail when read, else the list's copy; undefined while nothing can be shown. */
  readonly anomaly: AnomalyView | undefined
  /** The detail as read from the server (with its evidence); null until it is read, or when its read failed. */
  readonly detail: AnomalyDetail | null
  readonly loading: boolean
  /** The detail read failed. With an anomaly on screen this is the partial state; without, the whole dossier. */
  readonly failure: AnomalyReadFailure | null
  /** A refresh failed but the previous detail is still shown. */
  readonly stale: boolean
  readonly retrying: boolean
  readonly readAt: string | null
  readonly outcome: DossierOutcome | null
  /** Focus target after a selection on a stacked layout: the scrolling group, labelled by the title. */
  readonly focusRef?: Ref<HTMLDivElement>
  readonly onRetry: () => void
  readonly onBack: () => void
  /** The acknowledge command, offered only while the server's status is OPEN. */
  readonly onAcknowledge: () => void
}

/**
 * Dossier of one anomaly. Acknowledging is not resolving: the dossier has no resolve action, says so beside the one
 * action it offers, and never derives a status or an active fault from anything but the anomaly's own fields.
 */
export function AnomalyDossier({ anomaly, detail, loading, failure, stale, retrying, readAt, outcome, focusRef, onRetry, onBack, onAcknowledge }: AnomalyDossierProps) {
  const { m } = useI18n()
  const titleId = useId()
  const groupId = useId()
  const alertRef = useRef<HTMLDivElement>(null)
  const focusLost = useRef(false)
  const t = m.anomalies

  // The stale notice that had focus is gone; its target exists only after this commit (WCAG 2.4.3).
  useLayoutEffect(() => {
    if (!focusLost.current) return
    focusLost.current = false
    ;(anomaly === undefined ? alertRef.current : document.getElementById(groupId))?.focus()
  })

  if (anomaly === undefined) {
    return (
      <section className="ag-panel ag-dossier" aria-label={t.selectedOverline} aria-busy={loading || undefined}>
        {failure !== null ? (
          <div className="ag-dossier__alert" ref={alertRef} tabIndex={-1}>
            <AnomalyAlert failure={failure} onRetry={onRetry} onBack={onBack} retrying={retrying} />
          </div>
        ) : (
          <div className="ag-dossier__skel" aria-hidden="true">
            <span className="ag-skel__bar ag-skel__bar--title" />
            <span className="ag-skel__bar ag-skel__bar--block" />
            <span className="ag-skel__bar ag-skel__bar--facts" />
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="ag-panel ag-dossier" aria-labelledby={titleId}>
      {/* Scrolls on its own at ≥ 1024 px: focusable so the keyboard can scroll it (WCAG 2.1.1). */}
      <div id={groupId} className="ag-dossier__scroll" tabIndex={0} role="group" aria-labelledby={titleId} ref={focusRef}>
        {stale && (
          <div className="ag-dossier__stale">
            <StaleNotice
              evaluatedAt={readAt}
              body={(time) => t.staleBody({ time })}
              retrying={retrying}
              onRetry={onRetry}
              returnFocus={() => (focusLost.current = true)}
            />
          </div>
        )}
        {outcome === 'acknowledged' && (
          <div className="ag-an-outcome">
            <Alert kind="info" icon="status-info" title={t.acknowledgedOk} />
          </div>
        )}
        {outcome === 'resolvedMeanwhile' && (
          <div className="ag-an-outcome">
            <Alert kind="info" icon="status-info" title={t.resolvedMeanwhileTitle}>
              <p>{t.resolvedMeanwhileBody}</p>
            </Alert>
          </div>
        )}
        <DossierBody anomaly={anomaly} detail={detail} loading={loading} failure={failure} retrying={retrying} titleId={titleId} onRetry={onRetry} onAcknowledge={onAcknowledge} />
      </div>
    </section>
  )
}

function Section({ title, children, note }: { readonly title: string; readonly children: ReactNode; readonly note?: string }) {
  return (
    <section className="ag-an-sec">
      <h3 className="ag-overline">{title}</h3>
      {children}
      {note !== undefined && <p className="ag-an-sec__note">{note}</p>}
    </section>
  )
}

/** Free text sent by the server (notes): in a quotation, as written, never interpreted. */
function Quote({ children, source }: { readonly children: string; readonly source?: string }) {
  return (
    <blockquote className="ag-an-quote">
      <span className="ag-an-quote__text">{children}</span>
      {source !== undefined && <span className="ag-an-quote__src">{source}</span>}
    </blockquote>
  )
}

function Id({ id }: { readonly id: string }) {
  return <code className="ag-an-id">{id}</code>
}

interface DossierBodyProps {
  readonly anomaly: AnomalyView
  readonly detail: AnomalyDetail | null
  readonly loading: boolean
  readonly failure: AnomalyReadFailure | null
  readonly retrying: boolean
  readonly titleId: string
  readonly onRetry: () => void
  readonly onAcknowledge: () => void
}

function DossierBody({ anomaly, detail, loading, failure, retrying, titleId, onRetry, onAcknowledge }: DossierBodyProps) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.anomalies
  const severity = severityChip(anomaly.severity, i18n)
  const status = statusChip(anomaly.status, i18n)
  const lead =
    anomaly.status === 'OPEN'
      ? t.leadOpen
      : anomaly.status === 'ACKNOWLEDGED'
        ? t.leadAcknowledged
        : anomaly.status === 'RESOLVED' && anomaly.resolvedAt !== null
          ? t.leadResolved({ time: instantLabel(anomaly.resolvedAt, i18n) })
          : null
  const tone = anomaly.status === 'OPEN' ? 'anomaly' : anomaly.status === 'ACKNOWLEDGED' ? 'info' : 'none'
  const acknowledgedAt = anomaly.acknowledgedAt === null ? null : instantLabel(anomaly.acknowledgedAt, i18n)

  return (
    <>
      <p className="ag-overline">{t.selectedOverline}</p>
      <h2 className="ag-dossier__title" id={titleId}>
        {anomalyTypeLabel(anomaly, i18n)}
      </h2>
      <p className="ag-dossier__sub">{whereLine(anomaly, i18n)}</p>

      <div className={`ag-diag ag-an-diag--${tone}`}>
        <div className="ag-diag__row">
          <StatusChip role={severity.role} icon={severity.icon} size="lg">
            {severity.label}
          </StatusChip>
          <StatusChip role={status.role} icon={status.icon} size="lg">
            {status.label}
          </StatusChip>
        </div>
        {lead !== null && <p className="ag-an-diag__lead">{lead}</p>}
        {hasUnrecognizedValue(anomaly) && <p className="ag-diag__note ag-diag__note--unknown">{t.unrecognizedNote}</p>}
      </div>

      {anomaly.status === 'OPEN' && (
        <div className="ag-dossier__actions ag-an-actions" role="group" aria-label={t.actionsLabel}>
          <Button size="sm" aria-haspopup="dialog" onClick={onAcknowledge}>
            {t.acknowledge}
          </Button>
          <span className="ag-help">{t.acknowledgeHelp}</span>
        </div>
      )}

      <Section title={t.secWhere}>
        <dl className="ag-facts ag-an-grid">
          <div>
            <dt>{t.fCell}</dt>
            <dd>{anomaly.compartmentId === null ? t.notProvided : <Id id={anomaly.compartmentId} />}</dd>
            {anomaly.compartmentId !== null && <dd className="ag-help">{t.idOnly}</dd>}
          </div>
          <div>
            <dt>{t.fAsset}</dt>
            <dd>{anomaly.assetId === null ? t.notProvided : <Id id={anomaly.assetId} />}</dd>
            {anomaly.assetId !== null && <dd className="ag-help">{t.idOnly}</dd>}
          </div>
          <div>
            <dt>{t.fDetected}</dt>
            <dd>{instantLabel(anomaly.detectedAt, i18n)}</dd>
          </div>
          <div>
            <dt>{t.fType}</dt>
            {anomaly.type === UNRECOGNIZED ? (
              <>
                <dd>
                  <Id id={anomaly.typeCode} />
                </dd>
                <dd className="ag-help">{t.unrecognizedType}</dd>
              </>
            ) : (
              <dd>{anomalyTypeLabel(anomaly, i18n)}</dd>
            )}
          </div>
        </dl>
      </Section>

      <Section title={t.secEvidence}>
        <EvidenceBody detail={detail} loading={loading} failure={failure} retrying={retrying} onRetry={onRetry} />
      </Section>

      <Section title={t.secOperation}>
        {anomaly.lockerOperationId === null ? (
          <p>{t.noOperation}</p>
        ) : (
          <dl className="ag-facts">
            <div>
              <dt>{t.fOperation}</dt>
              <dd>
                <Id id={anomaly.lockerOperationId} />
              </dd>
            </div>
          </dl>
        )}
      </Section>

      <Section title={t.secAck}>
        {acknowledgedAt === null ? (
          <p>{t.notAcknowledged}</p>
        ) : (
          <>
            <p>{anomaly.acknowledgedBy === null ? t.acknowledgedAtOnly({ time: acknowledgedAt }) : t.acknowledgedBy({ name: anomaly.acknowledgedBy.displayName, time: acknowledgedAt })}</p>
            {anomaly.acknowledgementNote !== null && (
              <>
                <p className="ag-an-sec__note">{t.ackNote}</p>
                <Quote>{anomaly.acknowledgementNote}</Quote>
              </>
            )}
          </>
        )}
      </Section>

      <Section title={t.secResolution}>
        {anomaly.status === 'RESOLVED' || anomaly.resolvedAt !== null ? (
          <>
            {anomaly.resolvedAt !== null && <p>{t.resolvedAt({ time: instantLabel(anomaly.resolvedAt, i18n) })}</p>}
            {anomaly.resolutionEvidenceObservationId !== null && (
              <dl className="ag-facts">
                <div>
                  <dt>{t.resolutionObservation}</dt>
                  <dd>
                    <Id id={anomaly.resolutionEvidenceObservationId} />
                  </dd>
                  <dd className="ag-help">{t.idOnly}</dd>
                </div>
              </dl>
            )}
            {anomaly.resolutionNote !== null && (
              <>
                <p className="ag-an-sec__note">{t.resolutionNote}</p>
                <Quote source={t.resolutionNoteSource}>{anomaly.resolutionNote}</Quote>
              </>
            )}
          </>
        ) : anomaly.status === UNRECOGNIZED ? null : (
          <p>{t.notResolved}</p>
        )}
      </Section>
    </>
  )
}

interface EvidenceBodyProps {
  readonly detail: AnomalyDetail | null
  readonly loading: boolean
  readonly failure: AnomalyReadFailure | null
  readonly retrying: boolean
  readonly onRetry: () => void
}

function EvidenceBody({ detail, loading, failure, retrying, onRetry }: EvidenceBodyProps) {
  const { m } = useI18n()
  const t = m.anomalies
  if (detail === null) {
    if (failure !== null && failure.kind !== 'ended') {
      // The partial state: the list's fields stay readable, only this section is missing.
      return (
        <Alert kind="error" icon="status-error" title={t.detailPartialTitle} code={failure.kind === 'serviceError' ? (failure.traceId ?? undefined) : undefined} codeLabel={t.traceIdLabel}>
          <p>{t.detailPartialBody}</p>
          <div className="ag-alert__action">
            <Button variant="secondary" size="sm" busy={retrying} onClick={() => !retrying && onRetry()}>
              {t.retry}
            </Button>
          </div>
        </Alert>
      )
    }
    return loading || failure === null ? <p className="ag-an-sec__note">{t.evidenceLoading}</p> : null
  }
  if (detail.evidence === null) return <p>{t.evidenceUnavailable}</p>
  return <EvidenceList evidence={detail.evidence} />
}

function EvidenceList({ evidence }: { readonly evidence: AnomalyEvidence }) {
  const i18n = useI18n()
  const t = i18n.m.anomalies
  return (
    <>
      {evidence.items.length === 0 ? (
        <p>{t.evidenceNone}</p>
      ) : (
        <p className="ag-an-sec__note">{evidence.items.length + evidence.unreadable >= EVIDENCE_LIMIT ? t.evidenceLimitReached({ limit: EVIDENCE_LIMIT }) : t.evidenceLimit({ limit: EVIDENCE_LIMIT })}</p>
      )}
      {evidence.items.length > 0 && (
        <ul className="ag-an-evidence">
          {evidence.items.map((item) => (
            <li key={item.observationId} className="ag-an-evidence__item">
              <span className="ag-an-evidence__type">{item.type}</span>
              <span className="ag-an-evidence__when">
                {t.evidenceObserved({ time: instantLabel(item.observedAt, i18n) })}
                {item.receivedAt !== null && ` · ${t.evidenceReceived({ time: instantLabel(item.receivedAt, i18n) })}`}
              </span>
              <dl className="ag-an-evidence__ids">
                <div>
                  <dt>{t.evidenceObservation}</dt>
                  <dd>
                    <Id id={item.observationId} />
                  </dd>
                </div>
                {item.compartmentId !== null && (
                  <div>
                    <dt>{t.evidenceCell}</dt>
                    <dd>
                      <Id id={item.compartmentId} />
                    </dd>
                  </div>
                )}
                {item.operationId !== null && (
                  <div>
                    <dt>{t.evidenceOperation}</dt>
                    <dd>
                      <Id id={item.operationId} />
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {evidence.unreadable > 0 && <p className="ag-an-sec__note">{t.evidenceUnreadable({ count: evidence.unreadable })}</p>}
    </>
  )
}
