import { useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { Link } from '../../app/Link'
import { useI18n, type I18n } from '../../i18n/useI18n'
import { StatusChip } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { UNRECOGNIZED } from '../catalog/contract'
import { StaleNotice } from '../catalog/StaleNotice'
import { failureReasonLabel } from './failureReason'
import type { AssetSummary, LoanView, LockerOperationView, ReservationView, UserSummary } from './contract'
import { operationAuditHref } from '../audit/operationAuditHref'
import { LinkedAnomaly } from './LinkedAnomaly'
import { Timeline, type TimelineEntry } from './Timeline'
import { TransactionAlert } from './TransactionAlert'
import type { TransactionFailure } from './transactionFailure'
import { NO_FILTERS, transactionHref, type TransactionView } from './transactionHref'
import { isShownOverdue, isTerminalOperation, lateChip, loanChip, operationChip, operationTypeLabel, reservationChip, transactionTimes, type TransactionTimes } from './transactionPresentation'
import type { TransactionRecord } from './useTransactionQueries'
import { CurrentAttempt } from './CurrentAttempt'
import { CellName } from '../labels/Labels'
import { TechnicalDetails } from '../labels/TechnicalDetails'
import { useLabelIndex } from '../labels/useLabelIndex'

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
      </Link>
    </LinkRow>
  )
}

/** The holder by name (§1.2); the identifier is in « Détails techniques ». */
function HolderFact({ label, person, i18n }: { readonly label: string; readonly person: UserSummary | null; readonly i18n: I18n }) {
  const t = i18n.m.reservations
  return person !== null ? <Fact label={label}>{person.displayName}</Fact> : <Fact label={label} help={t.idOnlyHelp}>{t.holderUnnamed}</Fact>
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
    // §1.7: the diamond marks a due date that has passed; a reservation still running shows a hollow marker.
    { key: 'until', instant: r.reservedUntil, time: times.short(r.reservedUntil), label: t.timeline.until, kind: r.expiredAt !== null ? 'marker' : 'absent' },
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
          <HolderFact label={t.holderField} person={r.user} i18n={i18n} />
        </dl>
      </Section>
      <Section title={t.secOperations}>
        <div className="ag-links">
          <OperationLink label={t.factCurrentOperation} id={r.currentOperationId} empty={r.status === 'ACTIVE' ? t.noCurrentOperation : t.closedNoOperation} i18n={i18n} />
          <CurrentAttempt operationId={r.currentOperationId} activeReservedUntil={r.status === 'ACTIVE' ? r.reservedUntil : null} i18n={i18n} times={times} />
          {r.status === 'FULFILLED' && (
            <LinkRow label={t.loanLink}>
              {t.loanLinkMissing}{' '}
              <Link className="ag-link" to={transactionHref({ view: 'loans', filters: { ...NO_FILTERS, assetId: r.asset.id } })}>
                {t.loansOfAsset}
              </Link>
              {' · '}
              <Link className="ag-link" to={transactionHref({ view: 'operations', filters: { ...NO_FILTERS, assetId: r.asset.id } })}>
                {t.operationsOfAsset}
              </Link>
            </LinkRow>
          )}
        </div>
      </Section>
      <TechnicalDetails
        rows={[
          { label: t.factReservationId, value: r.id },
          { label: t.techAsset, value: r.asset.id },
          { label: t.techUser, value: r.userId },
          ...(r.currentOperationId === null ? [] : [{ label: t.factCurrentOperation, value: r.currentOperationId }]),
        ]}
      />
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
          <HolderFact label={t.holderField} person={l.holder} i18n={i18n} />
          <Fact label={t.factLate}>{l.overdue ? t.yes : t.no}</Fact>
        </dl>
      </Section>
      <Section title={t.secOperations}>
        <div className="ag-links">
          <OperationLink label={t.factCheckoutOperation} id={l.checkoutOperationId} empty="" i18n={i18n} />
          <OperationLink label={t.factReturnOperation} id={l.returnOperationId} empty={t.noReturnOperation} i18n={i18n} />
          <OperationLink label={t.factCurrentOperation} id={l.currentOperationId} empty={t.noCurrentOperation} i18n={i18n} />
          <CurrentAttempt operationId={l.currentOperationId} activeReservedUntil={null} i18n={i18n} times={times} />
        </div>
      </Section>
      <TechnicalDetails
        rows={[
          { label: t.factLoanId, value: l.id },
          { label: t.techAsset, value: l.asset.id },
          { label: t.techHolder, value: l.holderUserId },
          { label: t.factCheckoutOperation, value: l.checkoutOperationId },
          ...(l.returnOperationId === null ? [] : [{ label: t.factReturnOperation, value: l.returnOperationId }]),
          ...(l.currentOperationId === null || l.currentOperationId === l.returnOperationId ? [] : [{ label: t.factCurrentOperation, value: l.currentOperationId }]),
        ]}
      />
    </>
  )
}

/* ---------- locker operation ---------- */

function OperationBody({ operation: o, titleId, i18n, times }: BodyProps & { readonly operation: LockerOperationView }) {
  const t = i18n.m.reservations
  // R7: the operation names its user and its asset. Its own cell is named by the label index from `compartmentId`
  // (§1.1); the asset's placement is where it is NOW and is shown apart, as « Placement actuel ».
  const labels = useLabelIndex()
  const terminal = isTerminalOperation(o)
  const absent = terminal ? t.sequence.notReceived : t.sequence.notYetReceived
  const step = (key: string, instant: string | null, label: string, applicable = true): TimelineEntry => {
    if (!applicable) return { key, instant: null, time: '', label: `${label} · ${t.sequence.notApplicable}`, kind: 'absent' }
    return instant === null
      ? { key, instant: null, time: '', label, kind: 'absent', sub: absent }
      : { key, instant, time: times.clockSeconds(instant), label, kind: 'ok', sub: t.sequence.received }
  }
  const reasonLabel = o.failureReason === null ? null : failureReasonLabel(o.failureReason, i18n)
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
  if (o.status === 'FAILED') sequence.push({ key: 'end', instant: o.terminalAt, time: o.terminalAt === null ? '' : times.clockSeconds(o.terminalAt), label: t.sequence.failed, kind: 'blocked', sub: reasonLabel ?? o.failureReason ?? undefined })
  if (o.status === 'EXPIRED') sequence.push({ key: 'end', instant: o.terminalAt, time: o.terminalAt === null ? '' : times.clockSeconds(o.terminalAt), label: t.sequence.expired, kind: 'anomaly' })
  if (o.status === 'ANOMALY') sequence.push({ key: 'end', instant: o.terminalAt, time: o.terminalAt === null ? '' : times.clockSeconds(o.terminalAt), label: t.sequence.anomaly, kind: 'anomaly' })
  const tone = o.status === 'ANOMALY' ? 'anomaly' : o.status === 'CONFIRMED' ? 'none' : o.status === 'EXPIRED' ? 'warn' : o.status === 'FAILED' ? 'none' : 'info'
  const typeLabel = operationTypeLabel(o.type, i18n)
  const requiredAction = o.requiredAction === UNRECOGNIZED ? t.unrecognized : t.requiredAction[o.requiredAction]
  return (
    <>
      <Header
        overline={t.selectedOverline.operations}
        titleId={titleId}
        title={
          <>
            {typeLabel} · {assetTitle(o.asset)}
          </>
        }
        sub={times.full(o.createdAt)}
      />
      <Diagnostic tone={tone} chips={<Chip chip={operationChip(o.status, i18n)} />} notes={[t.callOperation]} />
      <Section title={t.secSequence} note={`${t.sequenceNote} ${t.zoneNote({ zone: LAB_TIME_ZONE })}`}>
        <Timeline entries={sequence} />
      </Section>
      <Section title={t.secFacts}>
        <dl className="ag-facts ag-facts--grid">
          <Fact label={t.factAsset}>{assetTitle(o.asset)}</Fact>
          <Fact label={t.operationCell}>
            <CellName compartmentId={o.compartmentId} label={labels.compartment(o.compartmentId)} />
          </Fact>
          <Fact label={t.factCurrentPlacement} help={t.currentPlacementHelp}>
            {placementText(o.asset, i18n)}
          </Fact>
          <HolderFact label={t.userField} person={o.user} i18n={i18n} />
          {o.failureReason !== null && <Fact label={t.failureReason}>{reasonLabel ?? o.failureReason}</Fact>}
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
            ) : o.type === 'CHECKOUT' && o.status === 'CONFIRMED' ? (
              t.checkoutLoanNote
            ) : (
              t.none
            )}
          </LinkRow>
          <LinkRow label={t.linkedAnomaly}>{o.anomalyId !== null ? <LinkedAnomaly anomalyId={o.anomalyId} i18n={i18n} full /> : t.noLinkedAnomaly}</LinkRow>
          <LinkRow label={t.linkedAudit}>
            <Link className="ag-link" to={operationAuditHref(o.id)}>
              {t.auditOfOperation}
            </Link>
          </LinkRow>
        </div>
      </Section>
      <TechnicalDetails
        rows={[
          { label: t.factOperationId, value: o.id },
          { label: t.techAsset, value: o.assetId },
          { label: t.techCell, value: o.compartmentId },
          { label: t.techLocker, value: o.lockerId },
          { label: t.techUser, value: o.userId },
          ...(o.localAccessChallengeId === null ? [] : [{ label: t.challenge, value: o.localAccessChallengeId }]),
          ...(o.failureReason === null ? [] : [{ label: t.failureReasonCode, value: o.failureReason }]),
        ]}
      />
    </>
  )
}
