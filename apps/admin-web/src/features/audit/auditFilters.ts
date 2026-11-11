import { resolveZonedInput } from '../../i18n/zonedTime'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { AUDIT_LIMIT_MAX, type AuditQuery } from './contract'

/** The filters of §19.1, in the order the form shows them. */
export const FILTER_FIELDS = ['from', 'to', 'eventType', 'subjectType', 'subjectId', 'operationId', 'actorUserId'] as const
export type FilterField = (typeof FILTER_FIELDS)[number]

/** One value per field, trimmed; an empty string is « no filter ». `from` and `to` are calendar days (`YYYY-MM-DD`). */
export type AuditFilters = Readonly<Record<FilterField, string>>

export const NO_FILTERS: AuditFilters = { from: '', to: '', eventType: '', subjectType: '', subjectId: '', operationId: '', actorUserId: '' }

/** Page size of a walk. The server caps `limit` at 100 (§19.1); the walk continues with « Charger plus ». */
export const AUDIT_PAGE_SIZE = 25

/** Names in the address: French, like the paths; the selected event is `evenement`. */
const PARAM: Readonly<Record<FilterField, string>> = {
  from: 'du',
  to: 'au',
  eventType: 'type',
  subjectType: 'sujetType',
  subjectId: 'sujet',
  operationId: 'operation',
  actorUserId: 'acteur',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The instant a laboratory-zone calendar day begins; null when the text is not a day that exists at midnight. */
function startOfDay(day: string): string | null {
  if (!DAY.test(day)) return null
  const resolved = resolveZonedInput(`${day}T00:00`, LAB_TIME_ZONE)
  if (resolved.kind === 'exact') return resolved.instant
  // Midnight repeated by a clock change: the earlier instant keeps the whole day.
  if (resolved.kind === 'ambiguous') return resolved.earlier
  return null
}

function nextDay(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)
}

export interface AuditLocation {
  readonly filters: AuditFilters
  /** The event shown in the dossier; null when the address names none (the first loaded event is shown). */
  readonly selectedId: string | null
  /** Fields whose value in the address is not a day: it filters nothing and the form says why. */
  readonly unreadable: readonly FilterField[]
}

/** `?du=2026-11-10&type=COMMAND_SENT&evenement=<id>`. A value that cannot be read is ignored, never guessed. */
export function readAuditLocation(search: string): AuditLocation {
  const params = new URLSearchParams(search)
  const filters: Record<FilterField, string> = { ...NO_FILTERS }
  const unreadable: FilterField[] = []
  for (const field of FILTER_FIELDS) {
    const value = (params.get(PARAM[field]) ?? '').trim()
    if ((field === 'from' || field === 'to') && value !== '' && startOfDay(value) === null) unreadable.push(field)
    else filters[field] = value
  }
  const selected = params.get('evenement')
  return { filters, selectedId: selected !== null && UUID.test(selected) ? selected.toLowerCase() : null, unreadable }
}

/** Address of the screen: only the filters that are set, then the selected event. */
export function auditHref(filters: AuditFilters, selectedId: string | null = null): string {
  const params = new URLSearchParams()
  for (const field of FILTER_FIELDS) if (filters[field] !== '') params.set(PARAM[field], filters[field])
  if (selectedId !== null) params.set('evenement', selectedId)
  const query = params.toString()
  return query === '' ? '/audit' : `/audit?${query}`
}

/**
 * The §19.1 query of the first page. « Du » is inclusive and « Au » names a day that is included, so the exclusive
 * `to` bound is the start of the following day, in the laboratory zone the form states.
 */
export function toAuditQuery(filters: AuditFilters): Omit<AuditQuery, 'cursor'> {
  const from = filters.from === '' ? null : startOfDay(filters.from)
  const to = filters.to === '' ? null : startOfDay(nextDay(filters.to))
  return {
    ...(filters.eventType === '' ? {} : { eventType: filters.eventType }),
    ...(filters.subjectType === '' ? {} : { subjectType: filters.subjectType }),
    ...(filters.subjectId === '' ? {} : { subjectId: filters.subjectId }),
    ...(filters.operationId === '' ? {} : { operationId: filters.operationId }),
    ...(filters.actorUserId === '' ? {} : { actorUserId: filters.actorUserId }),
    ...(from === null ? {} : { from }),
    ...(to === null ? {} : { to }),
    limit: Math.min(AUDIT_LIMIT_MAX, AUDIT_PAGE_SIZE),
  }
}

export function activeFilterFields(filters: AuditFilters): readonly FilterField[] {
  return FILTER_FIELDS.filter((field) => filters[field] !== '')
}

/** Narrows the parameter names a refused read named (`violations[].field`) to the fields of this form. */
export function refusedFields(names: readonly string[]): readonly FilterField[] {
  return FILTER_FIELDS.filter((field) => names.includes(field))
}
