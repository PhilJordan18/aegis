import { Link } from '../../app/Link'
import type { I18n } from '../../i18n/useI18n'
import { StatusChip } from '../../ui/StatusChip'
import { anomaliesHref, NO_FILTERS as NO_ANOMALY_FILTERS } from '../anomalies/anomalyLocation'
import { statusChip as anomalyStatusChip, instantLabel } from '../anomalies/anomalyPresentation'
import { IdText } from '../labels/IdText'
import { useLinkedAnomaly } from './useLinkedAnomaly'

/**
 * The anomaly an operation names: a link to its dossier and, when the read works, its own status. A command that was
 * acknowledged, an anomaly that was acknowledged and one that was resolved are three different facts: each has its own
 * words and none implies a physical confirmation. A failed read leaves the link alone.
 */
export function LinkedAnomaly({ anomalyId, i18n }: { readonly anomalyId: string; readonly i18n: I18n }) {
  const t = i18n.m.reservations
  const a = i18n.m.anomalies
  const read = useLinkedAnomaly(anomalyId)
  const anomaly = read.data
  const chip = anomaly === undefined ? null : anomalyStatusChip(anomaly.status, i18n)
  const lead =
    anomaly === undefined
      ? null
      : anomaly.status === 'OPEN'
        ? a.leadOpen
        : anomaly.status === 'ACKNOWLEDGED'
          ? a.leadAcknowledged
          : anomaly.status === 'RESOLVED' && anomaly.resolvedAt !== null
            ? a.leadResolved({ time: instantLabel(anomaly.resolvedAt, i18n) })
            : null
  return (
    <>
      <Link className="ag-link" to={anomaliesHref({ filters: NO_ANOMALY_FILTERS, page: 0, anomalyId })}>
        {t.openAnomaly}
      </Link>{' '}
      <IdText id={anomalyId} />
      {chip !== null && (
        <span className="ag-help ag-help--block">
          <StatusChip role={chip.role} icon={chip.icon}>
            {chip.label}
          </StatusChip>
          {lead !== null && <> {lead}</>}
        </span>
      )}
    </>
  )
}
