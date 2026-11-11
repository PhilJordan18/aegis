import { useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { Link } from '../../app/Link'
import { useI18n, type I18n } from '../../i18n/useI18n'
import { ReadOnlyMark } from '../../ui/ReadOnlyMark'
import { StatusChip } from '../../ui/StatusChip'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { UNRECOGNIZED } from '../catalog/contract'
import { StaleNotice } from '../catalog/StaleNotice'
import { useAsset } from '../catalog/useCatalogQueries'
import type { AssetSummary, LoanView, LockerOperationView, ReservationView } from './contract'
import { Timeline, type TimelineEntry } from './Timeline'
import { TransactionAlert } from './TransactionAlert'
import type { TransactionFailure } from './transactionFailure'
import { NO_FILTERS, transactionHref, type TransactionView } from './transactionHref'
import { isShownOverdue, isTerminalOperation, lateChip, loanChip, operationChip, operationTypeLabel, reservationChip, transactionTimes, type TransactionTimes } from './transactionPresentation'
import type { TransactionRecord } from './useTransactionQueries'

interface TransactionDossierProps {
  readonly view: TransactionView
  readonly record: TransactionRecord | undefined
  readonly loading: boolean
  readonly failure: TransactionFailure | null
  /** A refresh failed but the previous file is still shown. An initial failure is `failure`, not this. */
  readonly stale: boolean
  /** A refresh is running. */
  readonly retrying: boolean
  /** When the file on screen was read. */
  readonly readAt: number
  /** Focus target after a selection on a stacked layout: the scrolling group, labelled by the title. */
  readonly focusRef?: Ref<HTMLDivElement>
  readonly onRetry: () => void
  readonly onBack: () => void
}

/**
 * Dossier of one reservation, loan or locker operation. Read only: it offers no way to end a loan, confirm an
 * operation, force a return or open a door, and it never reads `availableActions`. Every step shows only the instant the
 * server sent.
 */
export function TransactionDossier({ view, record, loading, failure, stale, retrying, readAt, focusRef, onRetry, onBack }: TransactionDossierProps) {
  const i18n = useI18n()
  const titleId = useId()
  const groupId = useId()
  const alertRef = useRef<HTMLDivElement>(null)
  const focusLost = useRef(false)
  const label = i18n.m.reservations.selectedOverline[view]

  // The stale notice that had focus is gone: its target exists only after this commit (WCAG 2.4.3).
  useLayoutEffect(() => {
    if (!focusLost.current) return
    focusLost.current = false
    ;(record === undefined ? alertRef.current : document.getElementById(groupId))?.focus()
  })

  if (record === undefined) {
    return (
      <section className="ag-panel ag-dossier" aria-label={label} aria-busy={loading || undefined}>
        {failure !== null ? (
          <div className="ag-dossier__alert" ref={alertRef} tabIndex={-1}>
            <TransactionAlert failure={failure} onRetry={onRetry} onBack={onBack} />
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

  const times = transactionTimes(i18n)
  const read = times.readAt(readAt)
  return (
    <section className="ag-panel ag-dossier" aria-labelledby={titleId}>
      {/* Scrolls on its own at ≥ 1024 px: focusable so the keyboard can scroll it (WCAG 2.1.1). */}
      <div id={groupId} className="ag-dossier__scroll" tabIndex={0} role="group" aria-labelledby={titleId} ref={focusRef}>
        {stale && (
          <div className="ag-dossier__stale">
            <StaleNotice evaluatedAt={read} retrying={retrying} onRetry={onRetry} returnFocus={() => (focusLost.current = true)} />
          </div>
        )}
        {record.kind === 'reservations' && <ReservationBody reservation={record.item} titleId={titleId} i18n={i18n} times={times} />}
        {record.kind === 'loans' && <LoanBody loan={record.item} titleId={titleId} i18n={i18n} times={times} />}
        {record.kind === 'operations' && <OperationBody operation={record.item} titleId={titleId} i18n={i18n} times={times} />}
      </div>
    </section>
  )
}

/* ---------- shared pieces ---------- */

function Header({ overline, titleId, title, sub }: { readonly overline: string; readonly titleId: string; readonly title: ReactNode; readonly sub: string }) {
  return (
    <>
      <p className="ag-overline">{overline}</p>
      <h2 className="ag-dossier__title" id={titleId}>
        {title}
      </h2>
      {sub !== '' && <p className="ag-dossier__sub">{sub}</p>}
      <p className="ag-sec-title ag-dossier__readonly">
        <ReadOnlyMark />
      </p>
    </>
  )
}

function Section({ title, children, note }: { readonly title: string; readonly children: ReactNode; readonly note?: ReactNode }) {
  return (
    <section className="ag-sec">
      <h3 className="ag-overline">{title}</h3>
      {children}
      {note && <p className="ag-sec__note">{note}</p>}
    </section>
  )
}

function Fact({ label, children, help }: { readonly label: string; readonly children: ReactNode; readonly help?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {help && <span className="ag-help ag-help--block">{help}</span>}
      </dd>
    </div>
  )
}

const IdText = ({ id }: { readonly id: string }) => <code className="ag-id ag-id--full">{id}</code>

function LinkRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="ag-linkrow">
      <span className="ag-linkrow__label">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Diagnostic({ tone, chips, lead, notes }: { readonly tone: 'none' | 'info' | 'warn' | 'anomaly'; readonly chips: ReactNode; readonly lead?: string; readonly notes: readonly string[] }) {
  return (
    <div className={`ag-diag ag-diag--${tone}`}>
      <div className="ag-diag__row">{chips}</div>
      {lead && <p className="ag-diag__lead">{lead}</p>}
      {notes.map((note) => (
        <p className="ag-diag__note" key={note}>
          {note}
        </p>
      ))}
    </div>
  )
}

const Chip = ({ chip }: { readonly chip: { readonly role: Parameters<typeof StatusChip>[0]['role']; readonly icon: Parameters<typeof StatusChip>[0]['icon']; readonly label: string } }) => (
  <StatusChip role={chip.role} icon={chip.icon}>
    {chip.label}
  </StatusChip>
)

const modelLine = (asset: AssetSummary): string => [asset.model.manufacturer, asset.model.modelNumber].filter((part) => part !== null && part !== '').join(' ')
const assetTitle = (asset: AssetSummary) => (
  <>
    {asset.model.name} · <span className="ag-tnum">{asset.assetCode}</span>
  </>
)
const placementText = (asset: AssetSummary, i18n: I18n): string =>
  asset.placement === null ? i18n.m.reservations.noPlacement : `${asset.placement.lockerCode} · ${i18n.m.reservations.cell} ${asset.placement.compartmentCode}`

const opHref = (id: string) => transactionHref({ view: 'operations', selectedId: id })

function OperationLink({ label, id, empty, i18n }: { readonly label: string; readonly id: string | null; readonly empty: string; readonly i18n: I18n }) {
  const t = i18n.m.reservations
  if (id === null) return <LinkRow label={label}>{empty}</LinkRow>
  return (
    <LinkRow label={label}>
      <Link className="ag-link" to={opHref(id)}>
        {t.openOperation}
      </Link>{' '}
      <code className="ag-id">{id.slice(0, 8)}…</code>
    </LinkRow>
  )
}

function HolderFact({ label, id, i18n }: { readonly label: string; readonly id: string; readonly i18n: I18n }) {
  const t = i18n.m.reservations
  return (
    <Fact label={label} help={t.idOnlyHelp}>
      {t.idOnly}
      <br />
      <IdText id={id} />
    </Fact>
  )
}

/* ---------- reservation ---------- */

interface BodyProps {
  readonly titleId: string
  readonly i18n: I18n
  readonly times: TransactionTimes
}

function ReservationBody({ reservation: r, titleId, i18n, times }: BodyProps & { readonly reservation: ReservationView }) {
  const t = i18n.m.reservations
  const entries: TimelineEntry[] = [
    { key: 'created', instant: r.createdAt, time: times.short(r.createdAt), label: t.timeline.created },
    { key: 'from', instant: r.reservedFrom, time: times.short(r.reservedFrom), label: t.timeline.from },
    { key: 'until', instant: r.reservedUntil, time: times.short(r.reservedUntil), label: t.timeline.until, kind: 'marker' },
  ]
  if (r.fulfilledAt !== null) entries.push({ key: 'fulfilled', instant: r.fulfilledAt, time: times.short(r.fulfilledAt), label: t.timeline.fulfilled, kind: 'ok' })
  if (r.cancelledAt !== null) entries.push({ key: 'cancelled', instant: r.cancelledAt, time: times.short(r.cancelledAt), label: t.timeline.cancelled })
  if (r.expiredAt !== null) entries.push({ key: 'expired', instant: r.expiredAt, time: times.short(r.expiredAt), label: t.timeline.expired })
  if (r.status === 'ACTIVE') entries.push({ key: 'active', instant: null, time: '', label: t.timeline.active, kind: 'absent' })
  return (
    <>
      <Header overline={t.selectedOverline.reservations} titleId={titleId} title={assetTitle(r.asset)} sub={modelLine(r.asset)} />
      <Diagnostic tone={r.status === 'ACTIVE' ? 'info' : 'none'} chips={<Chip chip={reservationChip(r.status, i18n)} />} notes={[t.callReservation]} />
      <Section title={t.secTimeline} note={t.zoneNote({ zone: LAB_TIME_ZONE })}>
        <Timeline entries={entries} ordered />
      </Section>
      <Section title={t.secFacts}>
        <dl className="ag-facts ag-facts--grid">
          <Fact label={t.factAsset}>{assetTitle(r.asset)}</Fact>
          <Fact label={t.factPlacement}>{placementText(r.asset, i18n)}</Fact>
          <HolderFact label={t.holderField} id={r.userId} i18n={i18n} />
          <Fact label={t.factReservationId}>
            <IdText id={r.id} />
          </Fact>
        </dl>
      </Section>
      <Section title={t.secOperations}>
        <div className="ag-links">
          <OperationLink label={t.factCurrentOperation} id={r.currentOperationId} empty={r.status === 'ACTIVE' ? t.noCurrentOperation : t.closedNoOperation} i18n={i18n} />
          {r.status === 'FULFILLED' && (
            <LinkRow label={t.loanLink}>
              {t.loanLinkMissing}{' '}
              <Link className="ag-link" to={transactionHref({ view: 'operations', filters: { ...NO_FILTERS, assetId: r.asset.id } })}>
                {t.operationsOfAsset}
              </Link>
            </LinkRow>
          )}
        </div>
      </Section>
    </>
  )
}

/* ---------- loan ---------- */

function LoanBody({ loan: l, titleId, i18n, times }: BodyProps & { readonly loan: LoanView }) {
  const t = i18n.m.reservations
  const late = isShownOverdue(l)
  const entries: TimelineEntry[] = [
    { key: 'out', instant: l.checkedOutAt, time: times.short(l.checkedOutAt), label: t.timeline.checkedOut, kind: 'ok' },
    { key: 'due', instant: l.dueAt, time: times.short(l.dueAt), label: t.timeline.due, kind: late ? 'anomaly' : 'marker', sub: late ? t.lateSince({ time: times.zoned(l.dueAt) }) : undefined },
  ]
  if (l.returnRequestedAt !== null) entries.push({ key: 'requested', instant: l.returnRequestedAt, time: times.short(l.returnRequestedAt), label: t.timeline.returnRequested })
  entries.push(l.returnedAt !== null ? { key: 'returned', instant: l.returnedAt, time: times.short(l.returnedAt), label: t.timeline.returned, kind: 'ok' } : { key: 'returned', instant: null, time: '', label: t.timeline.notReturned, kind: 'absent' })
  return (
    <>
      <Header overline={t.selectedOverline.loans} titleId={titleId} title={assetTitle(l.asset)} sub={modelLine(l.asset)} />
      <Diagnostic
        tone={late ? 'warn' : l.status === 'RETURN_PENDING' ? 'info' : 'none'}
        chips={
          <>
            <Chip chip={loanChip(l.status, i18n)} />
            {late && <Chip chip={lateChip(i18n)} />}
          </>
        }
        lead={late ? t.callLate : l.status === 'RETURN_PENDING' ? t.callReturnPending : undefined}
        notes={late && l.status === 'RETURN_PENDING' ? [t.callReturnPending, t.callLoan] : [t.callLoan]}
      />
      <Section title={t.secTimeline} note={t.zoneNote({ zone: LAB_TIME_ZONE })}>
        <Timeline entries={entries} ordered />
      </Section>
      <Section title={t.secFacts}>
        <dl className="ag-facts ag-facts--grid">
          <Fact label={t.factAsset}>{assetTitle(l.asset)}</Fact>
          <Fact label={t.factPlacement}>{placementText(l.asset, i18n)}</Fact>
          <HolderFact label={t.holderField} id={l.holderUserId} i18n={i18n} />
          <Fact label={t.factLate}>{l.overdue ? t.yes : t.no}</Fact>
          <Fact label={t.factLoanId}>
            <IdText id={l.id} />
          </Fact>
        </dl>
      </Section>
      <Section title={t.secOperations}>
        <div className="ag-links">
          <OperationLink label={t.factCheckoutOperation} id={l.checkoutOperationId} empty="" i18n={i18n} />
          <OperationLink label={t.factReturnOperation} id={l.returnOperationId} empty={t.noReturnOperation} i18n={i18n} />
          <OperationLink label={t.factCurrentOperation} id={l.currentOperationId} empty={t.noCurrentOperation} i18n={i18n} />
        </div>
      </Section>
    </>
  )
}

/* ---------- locker operation ---------- */

function OperationBody({ operation: o, titleId, i18n, times }: BodyProps & { readonly operation: LockerOperationView }) {
  const t = i18n.m.reservations
  // The operation carries ids only. The equipment and its cell are read from the catalog (a read that exists), and
  // fall back to the identifier when it fails: nothing is guessed.
  const asset = useAsset(o.assetId, undefined)
  const unit = asset.data
  const cellCode = unit?.placement != null && unit.placement.compartmentId === o.compartmentId ? unit.placement.compartmentCode : null
  const lockerCode = unit?.placement != null && unit.placement.lockerId === o.lockerId ? unit.placement.lockerCode : null
  const terminal = isTerminalOperation(o)
  const absent = terminal ? t.sequence.notReceived : t.sequence.notYetReceived
  const step = (key: string, instant: string | null, label: string, applicable = true): TimelineEntry => {
    if (!applicable) return { key, instant: null, time: '', label: `${label} · ${t.sequence.notApplicable}`, kind: 'absent' }
    return instant === null
      ? { key, instant: null, time: '', label, kind: 'absent', sub: absent }
      : { key, instant, time: times.clockSeconds(instant), label, kind: 'ok', sub: t.sequence.received }
  }
  const hasChallenge = o.localAccessChallengeId !== null
  const sequence: TimelineEntry[] = [
    step('created', o.createdAt, t.sequence.created),
    step('displayed', o.localProofDisplayedAt, t.sequence.displayed, hasChallenge),
    step('validated', o.localProofValidatedAt, t.sequence.validated, hasChallenge),
    step('authorized', o.authorizedAt, t.sequence.authorized),
    step('sent', o.commandSentAt, t.sequence.sent),
    step('acknowledged', o.acknowledgedAt, t.sequence.acknowledged),
    step('doorOpened', o.doorOpenedAt, t.sequence.doorOpened),
    step('observed', o.observationReceivedAt, t.sequence.observed),
    step('confirmed', o.confirmedAt, t.sequence.confirmed),
  ]
  if (o.status === 'FAILED') sequence.push({ key: 'end', instant: o.terminalAt, time: o.terminalAt === null ? '' : times.clockSeconds(o.terminalAt), label: t.sequence.failed, kind: 'blocked', sub: o.failureReason ?? undefined })
  if (o.status === 'EXPIRED') sequence.push({ key: 'end', instant: o.terminalAt, time: o.terminalAt === null ? '' : times.clockSeconds(o.terminalAt), label: t.sequence.expired, kind: 'anomaly' })
  if (o.status === 'ANOMALY') sequence.push({ key: 'end', instant: o.terminalAt, time: o.terminalAt === null ? '' : times.clockSeconds(o.terminalAt), label: t.sequence.anomaly, kind: 'anomaly' })
  const tone = o.status === 'ANOMALY' ? 'anomaly' : o.status === 'CONFIRMED' ? 'none' : o.status === 'EXPIRED' ? 'warn' : o.status === 'FAILED' ? 'none' : 'info'
  const typeLabel = operationTypeLabel(o.type, i18n)
  const requiredAction = o.requiredAction === UNRECOGNIZED ? t.unrecognized : t.requiredAction[o.requiredAction]
  const joinFailed = asset.isError
  return (
    <>
      <Header
        overline={t.selectedOverline.operations}
        titleId={titleId}
        title={
          <>
            {typeLabel} · {unit !== undefined ? assetTitle({ ...unit }) : t.assetIdOnly}
          </>
        }
        sub={times.full(o.createdAt)}
      />
      <Diagnostic tone={tone} chips={<Chip chip={operationChip(o.status, i18n)} />} notes={[t.callOperation]} />
      {joinFailed && (
        <div className="ag-dossier__join">
          <Alert kind="warning" icon="status-offline" title={t.joinFailedTitle}>
            <p>{t.joinFailedBody}</p>
            <div className="ag-alert__action">
              <Button variant="secondary" size="sm" onClick={() => void asset.refetch()}>
                {i18n.m.equipment.retry}
              </Button>
            </div>
          </Alert>
        </div>
      )}
      <Section title={t.secSequence} note={`${t.sequenceNote} ${t.zoneNote({ zone: LAB_TIME_ZONE })}`}>
        <Timeline entries={sequence} />
      </Section>
      <Section title={t.secFacts}>
        <dl className="ag-facts ag-facts--grid">
          <Fact label={t.factAsset}>
            {unit !== undefined ? (
              assetTitle({ ...unit })
            ) : (
              <>
                {t.assetIdOnly}
                <br />
                <IdText id={o.assetId} />
              </>
            )}
          </Fact>
          <Fact label={t.cell}>
            {cellCode !== null ? (
              cellCode
            ) : (
              <>
                {t.cellIdOnly}
                <br />
                <IdText id={o.compartmentId} />
              </>
            )}
          </Fact>
          <Fact label={t.locker}>{lockerCode ?? <IdText id={o.lockerId} />}</Fact>
          <HolderFact label={t.userField} id={o.userId} i18n={i18n} />
          <Fact label={t.requiredActionField}>{requiredAction}</Fact>
          {o.expiresAt !== null && <Fact label={t.expiresAt}>{times.zoned(o.expiresAt)}</Fact>}
        </dl>
      </Section>
      <Section title={t.secOperations}>
        <div className="ag-links">
          <LinkRow label={t.linkedReservation}>
            {o.reservationId !== null ? (
              <Link className="ag-link" to={transactionHref({ view: 'reservations', selectedId: o.reservationId })}>
                {t.openReservation}
              </Link>
            ) : (
              t.none
            )}
          </LinkRow>
          <LinkRow label={t.linkedLoan}>
            {o.loanId !== null ? (
              <Link className="ag-link" to={transactionHref({ view: 'loans', selectedId: o.loanId })}>
                {t.openLoan}
              </Link>
            ) : (
              t.none
            )}
          </LinkRow>
          <LinkRow label={t.linkedAnomaly}>{o.anomalyId !== null ? <IdText id={o.anomalyId} /> : t.noLinkedAnomaly}</LinkRow>
        </div>
      </Section>
      <Section title={t.secTechnical}>
        <dl className="ag-kvs">
          <div>
            <dt>{t.factOperationId}</dt>
            <dd>{o.id}</dd>
          </div>
          {o.localAccessChallengeId !== null && (
            <div>
              <dt>{t.challenge}</dt>
              <dd>{o.localAccessChallengeId}</dd>
            </div>
          )}
          <div>
            <dt>{t.failureReason}</dt>
            <dd>{o.failureReason ?? t.none}</dd>
          </div>
        </dl>
      </Section>
    </>
  )
}
