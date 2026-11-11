import type { I18n } from '../../i18n/useI18n'
import type { IconName } from '../../ui/Icon'
import type { StatusRole } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { UNRECOGNIZED, type Unrecognized } from '../catalog/contract'
import type { AnomalySeverity, AnomalyStatus, AnomalyType, AnomalyView } from './contract'

export interface ChipView {
  readonly role: StatusRole
  readonly icon: IconName
  readonly label: string
}

/**
 * Severity and status are never carried by colour alone: each chip pairs a shape (octagon = blocking, diamond =
 * to watch, circle = information) with a symbol and its text. An unknown value is « unavailable », never a known one.
 */
const SEVERITY_CHIP: Record<AnomalySeverity, { role: StatusRole; icon: IconName }> = {
  HIGH: { role: 'blocked', icon: 'status-error' },
  MEDIUM: { role: 'unknown', icon: 'status-warn' },
  LOW: { role: 'info', icon: 'status-info' },
}

const STATUS_CHIP: Record<AnomalyStatus, { role: StatusRole; icon: IconName }> = {
  OPEN: { role: 'anomaly', icon: 'status-warn' },
  ACKNOWLEDGED: { role: 'info', icon: 'status-person' },
  RESOLVED: { role: 'neutral', icon: 'status-ready' },
}

export function severityChip(severity: AnomalyView['severity'], { m }: I18n): ChipView {
  if (severity === UNRECOGNIZED) return { role: 'unknown', icon: 'status-clock', label: m.anomalies.unrecognizedSeverity }
  return { ...SEVERITY_CHIP[severity], label: m.anomalies.severity[severity] }
}

export function statusChip(status: AnomalyView['status'], { m }: I18n): ChipView {
  if (status === UNRECOGNIZED) return { role: 'unknown', icon: 'status-clock', label: m.anomalies.unrecognizedStatus }
  return { ...STATUS_CHIP[status], label: m.anomalies.status[status] }
}

export function statusText(status: AnomalyView['status'], { m }: I18n): string {
  return status === UNRECOGNIZED ? m.anomalies.unrecognizedStatus : m.anomalies.status[status]
}

/**
 * D5: localized here from `type`. A type this version does not know falls back, in French only, to the server's
 * `summary` when it is a non-empty string (the compatible fallback), otherwise to the raw code. The English UI never
 * shows the summary, which is French prose. Nothing is ever built from `details` or evidence.
 */
export function typeLabel(type: AnomalyType | Unrecognized, { m, locale }: I18n, rawCode?: string, summary?: string): string {
  if (type !== UNRECOGNIZED) return m.anomalies.type[type]
  if (locale === 'fr' && typeof summary === 'string' && summary.trim() !== '') return summary
  return rawCode ?? m.anomalies.unrecognizedType
}

export function anomalyTypeLabel(anomaly: Pick<AnomalyView, 'type' | 'typeCode' | 'summary'>, i18n: I18n): string {
  return typeLabel(anomaly.type, i18n, anomaly.typeCode, anomaly.summary)
}

/** The server gives identifiers only (G3): shown as such, shortened in a row and in full in the dossier. */
export function shortId(id: string): string {
  return `${id.slice(0, 8)}…`
}

/** « Cellule 4e5f6071… · Équipement 7c9e6679… »: only what the server sent, no label invented from an identifier. */
export function whereLine(anomaly: AnomalyView, { m }: I18n): string {
  const parts = [anomaly.compartmentId === null ? m.anomalies.noCell : m.anomalies.cellId({ id: shortId(anomaly.compartmentId) })]
  if (anomaly.assetId !== null) parts.push(m.anomalies.assetId({ id: shortId(anomaly.assetId) }))
  return parts.join(' · ')
}

/** Business instant: date, time and zone abbreviation in the laboratory zone (the zone is also stated under the list). */
export function instantLabel(instant: string, { format }: I18n): string {
  return format.dateTime(new Date(instant), LAB_TIME_ZONE)
}

export function hasUnrecognizedValue(anomaly: AnomalyView): boolean {
  return anomaly.type === UNRECOGNIZED || anomaly.severity === UNRECOGNIZED || anomaly.status === UNRECOGNIZED
}

/** Accessible name of an anomaly: used by the selection announcement and the dossier. */
export function anomalyName(anomaly: AnomalyView, i18n: I18n): string {
  return `${anomalyTypeLabel(anomaly, i18n)}, ${whereLine(anomaly, i18n)}`
}

