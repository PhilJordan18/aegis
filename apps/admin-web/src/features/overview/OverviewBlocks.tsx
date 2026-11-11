import type { ReactNode } from 'react'
import { Link } from '../../app/Link'
import { useI18n, type I18n } from '../../i18n/useI18n'
import { StatusChip } from '../../ui/StatusChip'
import { anomaliesHref, NO_FILTERS as NO_ANOMALY_FILTERS } from '../anomalies/anomalyLocation'
import { anomalyTypeLabel, severityChip, shortId, statusChip } from '../anomalies/anomalyPresentation'
import type { AnomalyView } from '../anomalies/contract'
import type { LoanView, LockerOperationView, ReservationView, TransactionPage } from '../transactions/contract'
import { NO_FILTERS, transactionHref } from '../transactions/transactionHref'
import { lateChip, loanChip, operationChip, operationTypeLabel, reservationChip, transactionTimes } from '../transactions/transactionPresentation'
import { OverviewModule, PartialNotice } from './OverviewModule'
import { ROW_LIMIT, IN_PROGRESS_OPERATION_STATUSES, type AnomalySummary, type BlockRead, type Labels, type LoanSummary, type OperationSummary } from './overviewModel'

interface BlockProps {
  readonly retrying: boolean
  readonly onRetry: () => void
}

function Rows({ children }: { readonly children: ReactNode }) {
  return <ul className="ag-ov__body">{children}</ul>
}

function Row({ to, chips, main, meta }: { readonly to: string; readonly chips: ReactNode; readonly main: ReactNode; readonly meta: ReactNode }) {
  return (
    <li>
      <Link className="ag-ov__row" to={to}>
        <span className="ag-ov__chips">{chips}</span>
        <span className="ag-ov__main">{main}</span>
        <span className="ag-ov__meta">{meta}</span>
      </Link>
    </li>
  )
}

/** « Affichage de 5 sur 12. » when the page behind the link holds more than the block previews. */
function ShownNote({ shown, total }: { readonly shown: number; readonly total: number }) {
  const { m } = useI18n()
  return total > shown ? <span className="ag-ov__shown">{m.overview.shownOf({ shown, total })}</span> : null
}

function Foot({ to, label, shown, total }: { readonly to: string; readonly label: string; readonly shown: number; readonly total: number }) {
  return (
    <>
      <Link className="ag-link" to={to}>
        {label}
      </Link>
      <ShownNote shown={shown} total={total} />
    </>
  )
}

/** The holder as the contract gives it: the name when the admin view sends one (G1), the identifier otherwise. */
function holderText(person: { readonly displayName: string } | null, id: string, { m }: I18n): ReactNode {
  return person === null ? (
    <>
      {m.reservations.holderLine} <code className="ag-id">{shortId(id)}</code>
    </>
  ) : (
    <>
      {m.reservations.holderLabel} {person.displayName} <code className="ag-id">{shortId(id)}</code>
    </>
  )
}

function assetName(asset: LoanView['asset']): ReactNode {
  return (
    <>
      {asset.model.name} <span className="ag-ov__code">{asset.assetCode}</span>
    </>
  )
}

/** « Cellule A1 » from the locker list, or the identifier alone when the list does not name it (G3). */
function cellText(compartmentId: string | null, labels: Labels, { m }: I18n): string {
  if (compartmentId === null) return m.anomalies.noCell
  const code = labels.compartmentCode(compartmentId)
  return code === null ? m.anomalies.cellId({ id: shortId(compartmentId) }) : m.overview.cellCode({ code })
}

function assetText(assetId: string | null, labels: Labels, { m }: I18n): string | null {
  if (assetId === null) return null
  return labels.assetCode(assetId) ?? m.anomalies.assetId({ id: shortId(assetId) })
}

// ---------------------------------------------------------------- 1. anomalies

export function AnomaliesBlock({ read, labels, retrying, onRetry }: BlockProps & { readonly read: BlockRead<AnomalySummary>; readonly labels: Labels }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const summary = read.kind === 'ready' ? read.value : null
  return (
    <OverviewModule
      title={t.anomalies}
      className="ag-ov__mod--anomalies"
      primary
      read={read}
      retrying={retrying}
      onRetry={onRetry}
      count={summary === null ? undefined : summary.total > 0 ? { text: t.anomaliesCount({ count: summary.total }) } : { text: t.noneAnomalies, none: true }}
      foot={summary === null ? undefined : <Foot to={anomaliesHref({ filters: { ...NO_ANOMALY_FILTERS, status: 'OPEN' }, page: 0, anomalyId: null })} label={t.viewAnomalies} shown={summary.rows.length} total={summary.total} />}
    >
      {summary !== null && summary.rows.length > 0 && (
        <Rows>
          {summary.rows.map((anomaly) => (
            <AnomalyRow key={anomaly.id} anomaly={anomaly} labels={labels} />
          ))}
        </Rows>
      )}
    </OverviewModule>
  )
}

function AnomalyRow({ anomaly, labels }: { readonly anomaly: AnomalyView; readonly labels: Labels }) {
  const i18n = useI18n()
  const severity = severityChip(anomaly.severity, i18n)
  const status = statusChip(anomaly.status, i18n)
  const where = [cellText(anomaly.compartmentId, labels, i18n), assetText(anomaly.assetId, labels, i18n)].filter((part): part is string => part !== null).join(' · ')
  return (
    <Row
      // Opened by identifier, in every status: the dossier is read by id, whatever the list's filter.
      to={anomaliesHref({ filters: NO_ANOMALY_FILTERS, page: 0, anomalyId: anomaly.id })}
      chips={
        <>
          <StatusChip role={severity.role} icon={severity.icon}>
            {severity.label}
          </StatusChip>
          <StatusChip role={status.role} icon={status.icon}>
            {status.label}
          </StatusChip>
        </>
      }
      main={anomalyTypeLabel(anomaly, i18n)}
      // The time never breaks across two lines, and stays in the laboratory zone like every other row of this page.
      meta={`${where} · ${i18n.m.anomalies.detected({ time: transactionTimes(i18n).short(anomaly.detectedAt) })}`}
    />
  )
}

// -------------------------------------------------------------------- 2. loans

export function LoansBlock({ read, retrying, onRetry }: BlockProps & { readonly read: BlockRead<LoanSummary> }) {
  const i18n = useI18n()
  const { m, locale } = i18n
  const t = m.overview
  const times = transactionTimes(i18n)
  const summary = read.kind === 'ready' ? read.value : null
  const unread = summary?.gaps.find((gap) => gap.kind === 'unread')
  const truncated = summary?.gaps.find((gap) => gap.kind === 'truncated')

  let count: { text: string; none?: boolean } | undefined
  if (summary !== null) {
    const { n, exact } = summary.count
    if (exact) count = n > 0 ? { text: t.loansCount({ count: n }) } : { text: t.noneLoans, none: true }
    else count = n > 0 ? { text: t.loansMinimum({ count: n }) } : { text: t.loansNoneAmongRead, none: true }
  }

  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })
  return (
    <OverviewModule
      title={t.loans}
      className="ag-ov__mod--loans"
      read={read}
      retrying={retrying}
      onRetry={onRetry}
      count={count}
      foot={summary === null ? undefined : <Foot to={transactionHref({ view: 'loans' })} label={t.viewLoans} shown={Math.min(summary.overdue.length, ROW_LIMIT)} total={summary.overdue.length} />}
    >
      {summary !== null && summary.overdue.length > 0 && (
        <Rows>
          {summary.overdue.slice(0, ROW_LIMIT).map((loan) => (
            <Row
              key={loan.id}
              to={transactionHref({ view: 'loans', selectedId: loan.id })}
              chips={
                <>
                  <LoanStatusChip loan={loan} />
                  <LateChip />
                </>
              }
              main={assetName(loan.asset)}
              meta={
                <>
                  <strong>{m.reservations.lateSince({ time: times.short(loan.dueAt) })}</strong> · {holderText(loan.holder, loan.holderUserId, i18n)}
                </>
              }
            />
          ))}
        </Rows>
      )}
      {unread !== undefined && unread.kind === 'unread' && (
        <PartialNotice title={t.partialTitle} onRetry={onRetry} retrying={retrying}>
          {t.loansUnreadBody({ statuses: list.format(unread.statuses.map((status) => m.reservations.status.loan[status])) })}
        </PartialNotice>
      )}
      {truncated !== undefined && truncated.kind === 'truncated' && <PartialNotice title={t.partialTitle}>{t.loansTruncatedBody({ read: truncated.read, total: truncated.total })}</PartialNotice>}
    </OverviewModule>
  )
}

function LoanStatusChip({ loan }: { readonly loan: LoanView }) {
  const i18n = useI18n()
  const chip = loanChip(loan.status, i18n)
  return (
    <StatusChip role={chip.role} icon={chip.icon}>
      {chip.label}
    </StatusChip>
  )
}

function LateChip() {
  const i18n = useI18n()
  const chip = lateChip(i18n)
  return (
    <StatusChip role={chip.role} icon={chip.icon}>
      {chip.label}
    </StatusChip>
  )
}

// ---------------------------------------------------------------- 4. operations

export function OperationsBlock({ read, labels, retrying, onRetry }: BlockProps & { readonly read: BlockRead<OperationSummary>; readonly labels: Labels }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const times = transactionTimes(i18n)
  const summary = read.kind === 'ready' ? read.value : null

  let count: { text: string; none?: boolean } | undefined
  if (summary !== null) {
    const { n, exact } = summary.count
    if (exact) count = n > 0 ? { text: t.operationsCount({ count: n }) } : { text: t.noneOperations, none: true }
    else count = n > 0 ? { text: t.operationsMinimum({ count: n }) } : { text: t.operationsNoneAmongRead, none: true }
  }

  return (
    <OverviewModule
      title={t.operations}
      className="ag-ov__mod--operations"
      read={read}
      retrying={retrying}
      onRetry={onRetry}
      count={count}
      foot={summary === null ? undefined : <Foot to={transactionHref({ view: 'operations' })} label={t.viewOperations} shown={summary.rows.length} total={summary.count.n} />}
    >
      {summary !== null && summary.rows.length > 0 && (
        <Rows>
          {summary.rows.map((operation) => (
            <OperationRow key={operation.id} operation={operation} labels={labels} expiresAt={operation.expiresAt === null ? null : times.clock(operation.expiresAt)} />
          ))}
        </Rows>
      )}
      {summary !== null && summary.unread.length > 0 && (
        <PartialNotice title={t.partialTitle} onRetry={onRetry} retrying={retrying}>
          {t.operationsUnreadBody({ missing: summary.unread.length, total: IN_PROGRESS_OPERATION_STATUSES.length })}
        </PartialNotice>
      )}
      <p className="ag-ov__note">{t.operationsNote}</p>
    </OverviewModule>
  )
}

function OperationRow({ operation, labels, expiresAt }: { readonly operation: LockerOperationView; readonly labels: Labels; readonly expiresAt: string | null }) {
  const i18n = useI18n()
  const chip = operationChip(operation.status, i18n)
  const asset = assetText(operation.assetId, labels, i18n)
  const cell = cellText(operation.compartmentId, labels, i18n)
  return (
    <Row
      to={transactionHref({ view: 'operations', selectedId: operation.id })}
      chips={
        <StatusChip role={chip.role} icon={chip.icon}>
          {chip.label}
        </StatusChip>
      }
      main={`${operationTypeLabel(operation.type, i18n)} · ${asset ?? ''}`}
      meta={expiresAt === null ? cell : `${cell} · ${i18n.m.overview.expiresAt({ time: expiresAt })}`}
    />
  )
}

// -------------------------------------------------------------- 5. reservations

export function ReservationsBlock({ read, retrying, onRetry }: BlockProps & { readonly read: BlockRead<TransactionPage<ReservationView>> }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const times = transactionTimes(i18n)
  const page = read.kind === 'ready' ? read.value : null
  const active = { ...NO_FILTERS, status: 'ACTIVE' }
  return (
    <OverviewModule
      title={t.reservations}
      className="ag-ov__mod--reservations"
      read={read}
      retrying={retrying}
      onRetry={onRetry}
      count={page === null ? undefined : page.totalItems > 0 ? { text: t.reservationsCount({ count: page.totalItems }) } : { text: t.noneReservations, none: true }}
      foot={page === null ? undefined : <Foot to={transactionHref({ view: 'reservations', filters: active })} label={t.viewReservations} shown={page.items.length} total={page.totalItems} />}
    >
      {page !== null && page.items.length > 0 && (
        <Rows>
          {page.items.map((reservation) => {
            const chip = reservationChip(reservation.status, i18n)
            return (
              <Row
                key={reservation.id}
                to={transactionHref({ view: 'reservations', selectedId: reservation.id, filters: active })}
                chips={
                  <StatusChip role={chip.role} icon={chip.icon}>
                    {chip.label}
                  </StatusChip>
                }
                main={assetName(reservation.asset)}
                meta={
                  <>
                    {t.untilTime({ time: times.short(reservation.reservedUntil) })} · {holderText(reservation.user, reservation.userId, i18n)}
                  </>
                }
              />
            )
          })}
        </Rows>
      )}
    </OverviewModule>
  )
}
