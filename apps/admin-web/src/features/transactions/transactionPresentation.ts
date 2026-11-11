import { FORMAT_LOCALE } from '../../i18n/locale'
import type { I18n } from '../../i18n/useI18n'
import type { IconName } from '../../ui/Icon'
import type { StatusRole } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { UNRECOGNIZED, type Unrecognized } from '../catalog/contract'
import { TERMINAL_OPERATION_STATUSES, type LoanStatus, type LoanView, type LockerOperationStatus, type LockerOperationView, type ReservationStatus } from './contract'

type Chip = { readonly role: StatusRole; readonly icon: IconName; readonly label: string }

/**
 * Instants of these screens are shown in the laboratory zone, with its abbreviation where the zone matters (the
 * dossier); the browser zone is never used. Formatters are cached per language.
 */
const cache = new Map<string, Intl.DateTimeFormat>()
function formatter(locale: I18n['locale'], key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${locale}|${key}`
  let found = cache.get(id)
  if (found === undefined) {
    found = new Intl.DateTimeFormat(FORMAT_LOCALE[locale], { timeZone: LAB_TIME_ZONE, ...options })
    cache.set(id, found)
  }
  return found
}

export interface TransactionTimes {
  /** « 10 nov., 20 h 30 »: a list row. */
  readonly short: (instant: string) => string
  /** « 20 h 30 »: the end of a period that starts on the same day. */
  readonly clock: (instant: string) => string
  /** « 20 h 30 min 05 s »: a step of a physical sequence, where seconds matter. */
  readonly clockSeconds: (instant: string) => string
  /** « 10 nov. 2026, 20 h 30 min 05 s HNE »: a heading detail, zone included. */
  readonly full: (instant: string) => string
  /** « 20 h 30 HNE »: a time of day with its zone. */
  readonly zoned: (instant: string) => string
  /** Time of the device clock for « read at », in the laboratory zone with its abbreviation. */
  readonly readAt: (epochMs: number) => string
}

export function transactionTimes({ locale }: Pick<I18n, 'locale'>): TransactionTimes {
  const at = (key: string, options: Intl.DateTimeFormatOptions) => (instant: string) => formatter(locale, key, options).format(new Date(instant))
  return {
    short: at('short', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    clock: at('clock', { hour: 'numeric', minute: '2-digit' }),
    clockSeconds: at('clockSeconds', { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
    full: at('full', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }),
    zoned: at('zoned', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    readAt: (epochMs) => formatter(locale, 'zoned', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(epochMs)),
  }
}

function labelled<K extends string>(status: K | Unrecognized, labels: Readonly<Record<K, string>>, { m }: I18n): string {
  return status === UNRECOGNIZED ? m.reservations.unrecognized : labels[status]
}

export function reservationChip(status: ReservationStatus | Unrecognized, i18n: I18n): Chip {
  const label = labelled(status, i18n.m.reservations.status.reservation, i18n)
  switch (status) {
    case 'ACTIVE':
      return { role: 'progress', icon: 'status-info', label }
    case 'FULFILLED':
      return { role: 'neutral', icon: 'status-ready', label }
    case 'EXPIRED':
      return { role: 'neutral', icon: 'status-clock', label }
    default:
      return { role: 'neutral', icon: 'status-info', label }
  }
}

export function loanChip(status: LoanStatus | Unrecognized, i18n: I18n): Chip {
  const label = labelled(status, i18n.m.reservations.status.loan, i18n)
  switch (status) {
    case 'ACTIVE':
      return { role: 'progress', icon: 'status-person', label }
    case 'RETURN_PENDING':
      return { role: 'progress', icon: 'status-clock', label }
    case 'COMPLETED':
      return { role: 'neutral', icon: 'status-ready', label }
    default:
      return { role: 'neutral', icon: 'status-info', label }
  }
}

export function lateChip({ m }: I18n): Chip {
  return { role: 'unknown', icon: 'status-clock', label: m.reservations.lateChip }
}

/**
 * `overdue` is the server's boolean, read as sent: never derived from `dueAt` and the device clock. A completed loan
 * is not overdue whatever the flag says. An overdue loan stays borrowed: this only adds a mention, it never changes
 * the loan's status, and no screen here says that the equipment is available.
 */
export function isShownOverdue(loan: Pick<LoanView, 'overdue' | 'status'>): boolean {
  return loan.overdue && loan.status !== 'COMPLETED'
}

export function operationChip(status: LockerOperationStatus | Unrecognized, i18n: I18n): Chip {
  const label = labelled(status, i18n.m.reservations.status.operation, i18n)
  switch (status) {
    case 'CONFIRMED':
      return { role: 'ready', icon: 'status-ready', label }
    case 'FAILED':
      return { role: 'blocked', icon: 'status-blocked', label }
    case 'EXPIRED':
      return { role: 'unknown', icon: 'status-clock', label }
    case 'ANOMALY':
      return { role: 'anomaly', icon: 'status-warn', label }
    case UNRECOGNIZED:
      return { role: 'neutral', icon: 'status-info', label }
    default:
      return { role: 'progress', icon: 'status-clock', label }
  }
}

export function operationTypeLabel(type: LockerOperationView['type'], { m }: I18n): string {
  return type === UNRECOGNIZED ? m.reservations.unrecognized : m.reservations.operationType[type]
}

export function isTerminalOperation(operation: Pick<LockerOperationView, 'status' | 'terminalAt'>): boolean {
  return operation.terminalAt !== null || (operation.status !== UNRECOGNIZED && TERMINAL_OPERATION_STATUSES.includes(operation.status))
}

/** A UUID shortened for a list row (8 characters and an ellipsis); the dossier shows it whole and selectable. */
export const shortId = (id: string): string => `${id.slice(0, 8)}…`
