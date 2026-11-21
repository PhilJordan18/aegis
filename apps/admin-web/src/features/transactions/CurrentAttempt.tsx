import type { ReactNode } from 'react'
import type { I18n } from '../../i18n/useI18n'
import { StatusChip } from '../../ui/StatusChip'
import { UNRECOGNIZED } from '../catalog/contract'
import type { LockerOperationView } from './contract'
import { operationChip, type TransactionTimes } from './transactionPresentation'
import { LinkedAnomaly } from './LinkedAnomaly'
import { useOperationRead } from './useTransactionQueries'

function LinkRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="ag-linkrow">
      <span className="ag-linkrow__label">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function attemptLines(operation: LockerOperationView, i18n: I18n): readonly string[] {
  const t = i18n.m.reservations
  switch (operation.status) {
    case 'CONFIRMED':
      return [t.attemptConfirmed]
    case 'FAILED':
      return [t.attemptFailed]
    case 'EXPIRED':
      return [t.attemptExpired]
    case 'ANOMALY':
      return [t.attemptAnomaly]
    case UNRECOGNIZED:
      return []
    case 'COMMAND_ACKNOWLEDGED':
      return [t.attemptInProgress, t.attemptAcknowledged, t.attemptPhysicalPending]
    case 'DOOR_OPENED':
    case 'OBSERVATION_RECEIVED':
      return [t.attemptInProgress, t.attemptPhysicalPending]
    default:
      return [t.attemptInProgress]
  }
}

/**
 * 06 §14.1: past `reservedUntil`, the server keeps an ACTIVE reservation only while its CHECKOUT is authorized and not
 * yet classified, or physically uncertain (ANOMALY). The QR wait (REQUESTED, AWAITING_LOCAL_PROOF) never defers expiry.
 */
const DEFERRING_STATUSES: ReadonlySet<string> = new Set(['AUTHORIZED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'ANOMALY'])

/**
 * State of the current attempt of a reservation or loan, read through `currentOperationId`. The words follow the
 * attempt's own status as the server sent it, never the browser clock. Nothing is added when there is no attempt or it
 * cannot be read: the dossier keeps its link to the operation.
 */
export function CurrentAttempt({
  operationId,
  activeReservedUntil,
  i18n,
  times,
}: {
  readonly operationId: string | null
  /** `reservedUntil` of an ACTIVE reservation; null for a loan or a reservation in any other status. */
  readonly activeReservedUntil: string | null
  readonly i18n: I18n
  readonly times: TransactionTimes
}) {
  const t = i18n.m.reservations
  const read = useOperationRead(operationId)
  if (operationId === null) return null
  const record = read.data
  if (record === undefined) return read.isPending ? <LinkRow label={t.attemptState}>{t.attemptLoading}</LinkRow> : null
  if (record.kind !== 'operations') return null
  const operation = record.item
  const chip = operationChip(operation.status, i18n)
  const lines = [...attemptLines(operation, i18n)]
  // Past due at the time of this read, still ACTIVE, and an attempt the server may defer for: the deferral is the server's.
  const pastDue = activeReservedUntil !== null && Date.parse(activeReservedUntil) <= read.dataUpdatedAt
  if (pastDue && DEFERRING_STATUSES.has(operation.status)) lines.push(t.attemptDeferredExpiry)
  return (
    <LinkRow label={t.attemptState}>
      <StatusChip role={chip.role} icon={chip.icon}>
        {chip.label}
      </StatusChip>
      {lines.map((line) => (
        <span className="ag-help ag-help--block" key={line}>
          {line}
        </span>
      ))}
      {operation.anomalyId !== null && (
        <span className="ag-help ag-help--block">
          <LinkedAnomaly anomalyId={operation.anomalyId} i18n={i18n} />
        </span>
      )}
      <span className="ag-help ag-help--block">
        {t.attemptRead({ time: times.readAt(read.dataUpdatedAt) })}
        {read.isRefetchError && <> {t.attemptRefreshFailed}</>}
      </span>
    </LinkRow>
  )
}
