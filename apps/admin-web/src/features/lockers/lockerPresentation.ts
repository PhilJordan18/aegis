import type { I18n } from '../../i18n/useI18n'
import type { IconName } from '../../ui/Icon'
import type { StatusRole } from '../../ui/StatusChip'
import { UNRECOGNIZED, type Unrecognized } from '../catalog/contract'
import type { CompartmentStatus, DeviceError, LockerStatus, OperatingWindow } from './contract'

/**
 * How a state is drawn. `ok` and `neutral` are plain text; the others add a status chip with its symbol, so
 * an exception is never carried by colour alone. This is presentation over what the server sent: no state is
 * derived here, and an unknown value is never drawn as a healthy one.
 */
export type StateTone = 'ok' | 'neutral' | 'info' | 'blocked' | 'unknown'

export interface StateView {
  readonly tone: StateTone
  readonly icon: IconName
  readonly label: string
}

const TONE_ROLE: Record<Exclude<StateTone, 'ok' | 'neutral'>, StatusRole> = { info: 'info', blocked: 'blocked', unknown: 'unknown' }

/**
 * The value of a cell the hub has not confirmed lately: the server keeps the last heartbeat's values on the cells while the
 * locker is OFFLINE, so « Fermée » above « Hors ligne » is a memory, not a current fact. Drawn neutral, in plain text: no
 * « healthy » or « exception » treatment. The value itself is the server's, unchanged; nothing is derived.
 */
export function asLastKnown(view: StateView): StateView {
  return { ...view, tone: 'neutral' }
}

export function chipRole(tone: StateTone): StatusRole | null {
  return tone === 'ok' || tone === 'neutral' ? null : TONE_ROLE[tone]
}

function unrecognized({ m }: I18n): StateView {
  return { tone: 'unknown', icon: 'status-clock', label: m.equipment.unrecognized }
}

/** The locker's own connection chip: always a chip, since « En ligne » is the fact this screen exists for. */
export function connectionChip(status: LockerStatus['connectionStatus'], i18n: I18n): { role: StatusRole; icon: IconName; label: string } {
  if (status === UNRECOGNIZED) return { role: 'unknown', icon: 'status-clock', label: i18n.m.equipment.unrecognized }
  const label = i18n.m.lockers.connection[status]
  switch (status) {
    case 'ONLINE':
      return { role: 'ready', icon: 'status-online', label }
    case 'OFFLINE':
      return { role: 'blocked', icon: 'status-offline', label }
    case 'UNKNOWN':
      return { role: 'unknown', icon: 'status-clock', label }
  }
}

/** Why the connection is not « En ligne »; null when it is, or when the value is not recognized (see `hasUnrecognizedValue`). */
export function connectionNote(status: LockerStatus['connectionStatus'], { m }: I18n): string | null {
  return status === 'OFFLINE' || status === 'UNKNOWN' ? m.lockers.connectionNote[status] : null
}

export function linkState(value: CompartmentStatus['connectionStatus'], i18n: I18n): StateView {
  if (value === UNRECOGNIZED) return unrecognized(i18n)
  const label = i18n.m.lockers.link[value]
  return value === 'CONNECTED'
    ? { tone: 'ok', icon: 'status-online', label }
    : value === 'DISCONNECTED'
      ? { tone: 'blocked', icon: 'status-offline', label }
      : { tone: 'unknown', icon: 'status-clock', label }
}

export function readerState(value: CompartmentStatus['rfidReaderStatus'], i18n: I18n): StateView {
  if (value === UNRECOGNIZED) return unrecognized(i18n)
  const label = i18n.m.lockers.reader[value]
  return value === 'HEALTHY'
    ? { tone: 'ok', icon: 'status-online', label }
    : value === 'FAULTED'
      ? { tone: 'blocked', icon: 'status-error', label }
      : { tone: 'unknown', icon: 'status-clock', label }
}

/** An open door is a fact to notice, not a fault: it is expected during a custody operation. */
export function doorState(value: CompartmentStatus['doorState'], i18n: I18n): StateView {
  if (value === UNRECOGNIZED) return unrecognized(i18n)
  const label = i18n.m.lockers.door[value]
  return value === 'CLOSED'
    ? { tone: 'ok', icon: 'status-info', label }
    : value === 'OPEN'
      ? { tone: 'info', icon: 'status-info', label }
      : { tone: 'unknown', icon: 'status-clock', label }
}

export function lockState(value: CompartmentStatus['lockState'], i18n: I18n): StateView {
  if (value === UNRECOGNIZED) return unrecognized(i18n)
  const label = i18n.m.lockers.lock[value]
  return value === 'LOCKED'
    ? { tone: 'ok', icon: 'status-info', label }
    : value === 'UNLOCKED'
      ? { tone: 'info', icon: 'status-info', label }
      : { tone: 'unknown', icon: 'status-clock', label }
}

export function enabledState(enabled: boolean, { m }: I18n): StateView {
  return { tone: enabled ? 'ok' : 'neutral', icon: 'status-info', label: enabled ? m.equipment.yes : m.equipment.no }
}

/** True when any enumeration of the locker or its compartments is a value this client does not know (09 §3). */
export function hasUnrecognizedValue(locker: LockerStatus): boolean {
  const is = (value: string | Unrecognized) => value === UNRECOGNIZED
  return (
    is(locker.connectionStatus) ||
    is(locker.topology) ||
    locker.compartments.some((c) => is(c.connectionStatus) || is(c.rfidReaderStatus) || is(c.doorState) || is(c.lockState))
  )
}

/**
 * A reported device error (#29, 09 §8.6). CRITICAL is drawn as an exception and WARNING as information; neither is a
 * verdict on the locker: the connection chip and the compartment states stay the server's own.
 */
export function severityChip(severity: DeviceError['severity'], i18n: I18n): { role: StatusRole; icon: IconName; label: string } {
  if (severity === UNRECOGNIZED) return { role: 'unknown', icon: 'status-clock', label: i18n.m.equipment.unrecognized }
  const label = i18n.m.lockers.severity[severity]
  return severity === 'CRITICAL' ? { role: 'blocked', icon: 'status-error', label } : { role: 'info', icon: 'status-info', label }
}

/** The translated meaning of a 10 §13.2 code, or null for a code this client does not know (the code itself is always shown). */
export function errorCodeLabel(code: string, { m }: I18n): string | null {
  const labels: Readonly<Record<string, string>> = m.lockers.errorCode
  return Object.hasOwn(labels, code) ? (labels[code] ?? null) : null
}

/** Where the error was reported: the locker itself, one of its compartments by code, or an id the status does not list. */
export function errorPlace(error: DeviceError, locker: LockerStatus, { m }: I18n): string {
  if (error.compartmentId === null) return m.lockers.errorWholeLocker
  const compartment = locker.compartments.find((candidate) => candidate.id === error.compartmentId)
  return compartment === undefined ? m.lockers.errorUnlistedCompartment : m.lockers.errorCompartment({ code: compartment.code })
}

export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** An IANA identifier the browser can format with; anything else falls back to the device zone instead of throwing. */
export function usableTimeZone(zone: string | null): string {
  if (zone === null) return deviceTimeZone()
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return zone
  } catch {
    return deviceTimeZone()
  }
}

function parsedInstant(instant: string | null): Date | null {
  if (instant === null) return null
  const date = new Date(instant)
  return Number.isNaN(date.getTime()) ? null : date
}

const unbroken = (text: string) => text.replace(/ /g, '\u00A0')

/**
 * Date, time and zone abbreviation. The zone is always shown: the same instant is another calendar day in another
 * zone, and only the abbreviation tells a repeated hour apart. Each half stays on one line; it may break after the comma.
 */
function instantLabel(instant: string | null, timeZone: string, { format }: I18n): string | null {
  const date = parsedInstant(instant)
  if (date === null) return null
  const text = format.dateTime(date, timeZone)
  const cut = text.lastIndexOf(', ')
  return cut < 0 ? unbroken(text) : `${unbroken(text.slice(0, cut))}, ${unbroken(text.slice(cut + 2))}`
}

/** A technical instant (heartbeat, observation, evaluation): the device zone, as the equipment dossier does. */
export function technicalInstantLabel(instant: string | null, i18n: I18n): string | null {
  return instantLabel(instant, deviceTimeZone(), i18n)
}

/** Time of day of the evaluation, for the stale notice. */
export function evaluatedTimeLabel(locker: LockerStatus, { format }: I18n): string | null {
  const date = parsedInstant(locker.evaluatedAt)
  return date === null ? null : format.time(date)
}

export interface WindowView {
  readonly kind: 'open' | 'closed' | 'noSchedule'
  readonly zone: string | null
  readonly closesAt: string | null
  readonly nextOpensAt: string | null
}

/** Business instants (closing, next opening) are shown in the locker's own zone. `open` is the server's verdict. */
export function windowView(operating: OperatingWindow, i18n: I18n): WindowView {
  const zone = usableTimeZone(operating.timeZone)
  const closesAt = operating.open ? instantLabel(operating.closesAt, zone, i18n) : null
  const nextOpensAt = operating.open ? null : instantLabel(operating.nextOpensAt, zone, i18n)
  const hasSchedule = operating.open || operating.nextOpensAt !== null
  return {
    kind: operating.open ? 'open' : hasSchedule ? 'closed' : 'noSchedule',
    zone: operating.timeZone === null ? null : zone,
    closesAt,
    nextOpensAt,
  }
}
