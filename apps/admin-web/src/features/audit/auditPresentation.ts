import type { I18n } from '../../i18n/useI18n'
import type { StatusRole } from '../../ui/StatusChip'
import type { IconName } from '../../ui/Icon'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { isInstant } from '../lockers/contractParsers'
import type { AuditActor, AuditDetails, AuditEventView } from './contract'

/** A label from the catalog; a code the catalog does not hold (including a prototype key such as `constructor`) has none. */
function lookup(table: Readonly<Record<string, string>>, code: string): string | null {
  return Object.hasOwn(table, code) ? (table[code] ?? null) : null
}

/** « Commande envoyée au casier », or « Événement non reconnu · CODE »: a code this version does not know stays visible. */
export function eventLabel(eventType: string, { m }: I18n): string {
  return lookup(m.audit.event, eventType) ?? `${m.audit.unknownEvent} · ${eventType}`
}

export function subjectLabel(subjectType: string, { m }: I18n): string {
  return lookup(m.audit.subject, subjectType) ?? subjectType
}

export function stateLabel(state: string, { m }: I18n): string {
  return lookup(m.audit.state, state) ?? `${m.audit.unknownState} · ${state}`
}

/** A UUID shortened for a list row; the dossier shows it whole. */
export function shortId(id: string): string {
  return `${id.slice(0, 8)}…`
}

export type ActorView =
  | { readonly kind: 'user'; readonly name: string; readonly id: string }
  /** `actor: null`: the server associates no user with the event. */
  | { readonly kind: 'system'; readonly name: string }
  /** A shape the contract has not defined: nothing is read from it. */
  | { readonly kind: 'unreadable'; readonly name: string }

export function actorView(actor: AuditActor, { m }: I18n): ActorView {
  if (actor === null) return { kind: 'system', name: m.audit.actorSystem }
  if ('kind' in actor) return { kind: 'unreadable', name: m.audit.actorUnreadable }
  return { kind: 'user', name: actor.displayName, id: actor.id }
}

export interface ResultChip {
  readonly role: StatusRole
  readonly icon: IconName
  readonly label: string
}

/**
 * The result of an event, from the codes the database admits (V002_2 `ck_audit_events_result`). Shape, symbol and text
 * carry it, never the colour alone. A null result has no chip: the dossier says so. An unknown code shows as it is.
 */
export function resultChip(result: string | null, { m }: I18n): ResultChip | null {
  if (result === null) return null
  const label = lookup(m.audit.result, result)
  if (label === null) return { role: 'neutral', icon: 'status-info', label: m.audit.unknownResult({ code: result }) }
  switch (result) {
    case 'ACCEPTED':
      return { role: 'ready', icon: 'status-ready', label }
    case 'REJECTED':
      return { role: 'blocked', icon: 'status-blocked', label }
    case 'IN_PROGRESS':
      return { role: 'progress', icon: 'status-clock', label }
    case 'CONFLICT':
    case 'ANOMALY_REQUIRES_ACTION':
      return { role: 'unknown', icon: 'status-warn', label }
    default:
      return { role: 'info', icon: 'status-info', label }
  }
}

/** The calendar day of an instant in the laboratory zone (`2026-11-11`): the key events are grouped under. */
export function labDay(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LAB_TIME_ZONE }).format(new Date(instant))
}

export interface DayGroup {
  readonly day: string
  readonly heading: string
  readonly events: readonly AuditEventView[]
}

/** Consecutive events of one laboratory day under one heading; the order is the server's (newest first) and is never changed. */
export function groupByDay(events: readonly AuditEventView[], { format }: I18n): readonly DayGroup[] {
  const groups: { day: string; heading: string; events: AuditEventView[] }[] = []
  for (const event of events) {
    const day = labDay(event.occurredAt)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.day === day) last.events.push(event)
    else groups.push({ day, heading: format.dayHeading(new Date(event.occurredAt), LAB_TIME_ZONE), events: [event] })
  }
  return groups
}

export const clockOf = (instant: string, { format }: I18n) => format.clockSeconds(new Date(instant), LAB_TIME_ZONE)
export const fullTimeOf = (instant: string, { format }: I18n) => format.dateTimeSeconds(new Date(instant), LAB_TIME_ZONE)

/** Detail keys the backend allowlist fills with an instant (AuditDetailsFilter): shown in the laboratory zone. */
const INSTANT_KEYS: ReadonlySet<string> = new Set(['revokedAt', 'archivedAt', 'cancelledAt', 'reservedFrom', 'reservedUntil'])

export interface DetailRow {
  /** The key as sent; always available, shown alone when the catalog has no label. */
  readonly key: string
  readonly label: string | null
  /** The text a reader scans: a localized label, a formatted instant, a yes/no, a number or the string as sent. */
  readonly text: string
  /** The code as sent, shown beside a localized label; null when the text already is the value. */
  readonly code: string | null
  /** Set when `text` is a formatted instant, so the machine-readable value stays in the markup. */
  readonly instant: string | null
  /** True for a string shown as sent (an identifier, a code): it is set in the code style. */
  readonly raw: boolean
}

/**
 * The scalar details of an event as read-only rows (D9). A key the catalog does not know shows as sent, a value is
 * shown as sent unless a label for the code is obvious (a state or a result) or it is an instant of the allowlist.
 */
export function detailRows(details: AuditDetails, i18n: I18n): readonly DetailRow[] {
  const { m } = i18n
  return details.entries.map(([key, value]): DetailRow => {
    const label = lookup(m.audit.detailKey, key)
    if (value === null) return { key, label, text: m.audit.detailNull, code: null, instant: null, raw: false }
    if (typeof value === 'boolean') return { key, label, text: value ? m.audit.detailTrue : m.audit.detailFalse, code: null, instant: null, raw: false }
    if (typeof value === 'number') return { key, label, text: String(value), code: null, instant: null, raw: false }
    if (INSTANT_KEYS.has(key) && isInstant(value)) return { key, label, text: fullTimeOf(value, i18n), code: null, instant: value, raw: false }
    const known = key === 'status' || key === 'operationStatus' ? lookup(m.audit.state, value) : key === 'outcome' ? lookup(m.audit.result, value) : null
    return known === null ? { key, label, text: value, code: null, instant: null, raw: true } : { key, label, text: known, code: value, instant: null, raw: false }
  })
}
