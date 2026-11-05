import type { I18n } from '../../i18n/useI18n'
import type { StatusRole } from '../../ui/StatusChip'
import type { IconName } from '../../ui/Icon'
import { UNRECOGNIZED, type AdminAssetView, type DiagnosticReason, type Unrecognized } from './contract'

/**
 * Business instants (a calibration due date) are shown in the laboratory zone, never the browser's.
 * The API exposes no locker or laboratory zone on an asset yet (docs/localisation/convention.md),
 * so the zone is the P0 laboratory convention, stated on screen next to the instant. The calibration
 * status itself is computed by the server and is never derived from this instant here.
 */
export const LAB_TIME_ZONE = 'America/Toronto'

export type DiagnosticTone = 'none' | 'unknown' | 'blocked'

/**
 * How the diagnostic is treated visually. This is a presentation choice over the reasons the server
 * sent: it never computes readiness. An empty list is « none detected », not « ready ».
 */
export function diagnosticTone(reasons: readonly (DiagnosticReason | Unrecognized)[]): DiagnosticTone {
  if (reasons.length === 0) return 'none'
  return reasons.every((reason) => reason === 'UNKNOWN_PHYSICAL_STATE') ? 'unknown' : 'blocked'
}

const TONE_CHIP: Record<DiagnosticTone, { role: StatusRole; icon: IconName }> = {
  none: { role: 'neutral', icon: 'status-info' },
  unknown: { role: 'unknown', icon: 'status-clock' },
  blocked: { role: 'blocked', icon: 'status-blocked' },
}

export function diagnosticChip(asset: AdminAssetView, { m }: I18n): { role: StatusRole; icon: IconName; label: string } {
  const reasons = asset.operationalDiagnostic.reasons
  const chip = TONE_CHIP[diagnosticTone(reasons)]
  return { ...chip, label: reasons.length === 0 ? m.equipment.noBlockers : m.equipment.blockers({ count: reasons.length }) }
}

function parsedInstant(instant: string | null): Date | null {
  if (instant === null) return null
  const date = new Date(instant)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateOf(instant: string | null, { format }: I18n): string | null {
  const date = parsedInstant(instant)
  // A date never breaks across two lines.
  return date === null ? null : format.date(date, LAB_TIME_ZONE).replace(/ /g, '\u00A0')
}

/**
 * A calibration due instant: date, time and zone abbreviation in the laboratory zone. The date and the
 * time with its zone each stay on one line; the line may break after the comma that separates them.
 */
function dueOf(instant: string | null, { format }: I18n): string | null {
  const date = parsedInstant(instant)
  if (date === null) return null
  // The time carries no comma, so the last one separates it from the date; an English date has its own comma.
  const text = format.dateTime(date, LAB_TIME_ZONE)
  const cut = text.lastIndexOf(', ')
  const unbroken = (part: string) => part.replace(/ /g, '\u00A0')
  return cut < 0 ? unbroken(text) : `${unbroken(text.slice(0, cut))}, ${unbroken(text.slice(cut + 2))}`
}

/** True when any enumeration of the unit is a value this client does not know (09 §3). */
export function hasUnrecognizedValue(asset: AdminAssetView): boolean {
  return (
    asset.availability === UNRECOGNIZED ||
    asset.presence === UNRECOGNIZED ||
    asset.operationalStatus === UNRECOGNIZED ||
    asset.requiredAccessLevel === UNRECOGNIZED ||
    asset.calibration.status === UNRECOGNIZED ||
    asset.operationalDiagnostic.reasons.includes(UNRECOGNIZED)
  )
}

export function availabilityLabel(value: AdminAssetView['availability'], { m }: I18n): string {
  return value === UNRECOGNIZED ? m.equipment.unrecognized : m.equipment.availability[value]
}

export function presenceLabel(value: AdminAssetView['presence'], { m }: I18n): string {
  return value === UNRECOGNIZED ? m.equipment.unrecognized : m.equipment.presence[value]
}

export function serviceStateLabel(value: AdminAssetView['operationalStatus'], { m }: I18n): string {
  return value === UNRECOGNIZED ? m.equipment.unrecognized : m.equipment.serviceState[value]
}

export function accessLevelLabel(value: AdminAssetView['requiredAccessLevel'], { m }: I18n): string {
  return value === UNRECOGNIZED ? m.equipment.unrecognized : m.equipment.accessLevel[value]
}

/** One reason as a sentence; an expired calibration says since when, when the server gave the due instant. */
export function reasonLabel(reason: DiagnosticReason | Unrecognized, asset: AdminAssetView, i18n: I18n): string {
  if (reason === UNRECOGNIZED) return i18n.m.equipment.unrecognized
  if (reason === 'CALIBRATION_EXPIRED') {
    const date = dueOf(asset.calibration.dueAt, i18n)
    if (date !== null) return i18n.m.equipment.calibrationExpiredOn({ date })
  }
  return i18n.m.equipment.reason[reason]
}

export function calibrationLabel(asset: AdminAssetView, i18n: I18n): string {
  const { calibration } = asset
  const { m } = i18n
  const date = dueOf(calibration.dueAt, i18n)
  switch (calibration.status) {
    case UNRECOGNIZED:
      return m.equipment.unrecognized
    case 'NOT_REQUIRED':
    case 'UNKNOWN':
      return m.equipment.calibrationStatus[calibration.status]
    case 'VALID':
      return date === null ? m.equipment.calibrationStatus.UNKNOWN : m.equipment.calibrationValidUntil({ date })
    case 'EXPIRED':
      return date === null ? m.equipment.reason.CALIBRATION_EXPIRED : m.equipment.calibrationExpiredSince({ date })
  }
}

export function calibrationDueLabel(asset: AdminAssetView, i18n: I18n): string {
  return dueOf(asset.calibration.dueAt, i18n) ?? i18n.m.equipment.notProvided
}

export function factsLine(asset: AdminAssetView, i18n: I18n): string {
  const { m } = i18n
  return m.equipment.facts({
    availability: availabilityLabel(asset.availability, i18n),
    presence: asset.presence === UNRECOGNIZED ? m.equipment.unrecognized : m.equipment.presenceInline[asset.presence],
    status: serviceStateLabel(asset.operationalStatus, i18n),
  })
}

export function archivedDateLabel(asset: AdminAssetView, i18n: I18n): string | null {
  const date = dateOf(asset.archivedAt, i18n)
  return date === null ? null : i18n.m.equipment.archivedOn({ date })
}

/** Neutral or informative, never the « ready » green: availability is not readiness. */
export function availabilityRole(availability: AdminAssetView['availability']): StatusRole {
  return availability === 'AVAILABLE' ? 'progress' : availability === 'RESERVED' || availability === 'BORROWED' ? 'info' : 'neutral'
}

/** Technical instant, in the device zone. */
export function evaluatedAtLabel(asset: AdminAssetView, { format }: I18n): string {
  return format.time(new Date(asset.operationalDiagnostic.evaluatedAt))
}

/** Accessible name of a unit, also used by the selection announcement. */
export function assetName(asset: AdminAssetView): string {
  return `${asset.model.name}, ${asset.assetCode}`
}
