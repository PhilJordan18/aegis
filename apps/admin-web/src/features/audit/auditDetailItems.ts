import type { I18n } from '../../i18n/useI18n'
import { isInstant } from '../lockers/contractParsers'
import { isAllowlistedLeaf, leafRank } from './auditDetailPaths'
import { detailRows, fullTimeOf } from './auditPresentation'
import type { AuditDetails, AuditDetailValue } from './contract'

/** A label from a catalog table; a code the table does not hold (including a prototype key) has none. */
function lookup(table: Readonly<Record<string, string>>, code: string): string | null {
  return Object.hasOwn(table, code) ? (table[code] ?? null) : null
}

/** One value as a reader scans it: a localized label, a formatted instant, a yes/no or the string as sent. */
export interface DetailValueView {
  readonly text: string
  /** The code as sent, shown beside a localized label; null when the text already is the value. */
  readonly code: string | null
  /** Set when `text` is a formatted instant, so the machine-readable value stays in the markup. */
  readonly instant: string | null
  /** True for a string shown as sent (an identifier, a code): it is set in the code style. */
  readonly raw: boolean
}

interface ItemBase {
  /** Stable within one event: the path, or the day of a schedule. */
  readonly id: string
  /** The localized name of the field; null shows `key` alone. */
  readonly label: string | null
  readonly key: string
}

/**
 * What the dossier lists. A `row` is one value, a `change` is a before and an after of one field (a catalog update, a
 * placement, a schedule day), a `list` is the identifiers of a list. Nothing here is a raw structure.
 */
export type DetailItem =
  | (ItemBase & { readonly kind: 'row'; readonly value: DetailValueView })
  | (ItemBase & { readonly kind: 'change'; readonly before: DetailValueView; readonly after: DetailValueView })
  | (ItemBase & { readonly kind: 'list'; readonly values: readonly DetailValueView[] })

/** Fields whose string is prose, not a code: set in the body style. */
const PLAIN_FIELDS: ReadonlySet<string> = new Set(['name', 'manufacturer', 'modelNumber', 'timeZone'])
const INSTANT_FIELDS: ReadonlySet<string> = new Set(['calibrationDueAt', 'assignedAt', 'revokedAt'])

/** Labels of the nested fields: the catalog, locker and schedule screens already name them, so those texts are reused. */
function fieldLabels({ m }: I18n): Readonly<Record<string, string>> {
  const edit = m.catalogEdit
  const key = m.audit.detailKey
  return {
    name: edit.fieldModelName,
    manufacturer: edit.fieldManufacturer,
    modelNumber: edit.fieldModelNumber,
    defaultCalibrationRequired: edit.fieldDefaultCalibration,
    assetModelId: key.assetModelId ?? 'assetModelId',
    assetCode: edit.fieldAssetCode,
    serialNumber: edit.fieldSerialNumber,
    requiredAccessLevel: edit.fieldAccessLevel,
    operationalStatus: edit.fieldServiceState,
    calibrationRequired: edit.fieldCalibrationRequired,
    calibrationDueAt: edit.fieldCalibrationDue,
    timeZone: m.schedule.fieldTimeZone,
    assetId: key.assetId ?? 'assetId',
    type: key.type ?? 'type',
    placementId: key.placementId ?? 'placementId',
    lockerId: key.lockerId ?? 'lockerId',
    lockerCode: key.lockerCode ?? 'lockerCode',
    compartmentId: key.compartmentId ?? 'compartmentId',
    compartmentCode: key.compartmentCode ?? 'compartmentCode',
    assignedAt: key.assignedAt ?? 'assignedAt',
    endedOperationIds: key.endedOperationIds ?? 'endedOperationIds',
  }
}

function formatTimeOfDay(value: string): string {
  return /^\d{2}:\d{2}:00$/.test(value) ? value.slice(0, 5) : value
}

/** A leaf of a nested path, by the field it fills: states and levels carry their label and keep the code beside it. */
function valueView(field: string, value: AuditDetailValue, i18n: I18n): DetailValueView {
  const { m } = i18n
  if (value === null) return { text: m.audit.detailNull, code: null, instant: null, raw: false }
  if (typeof value === 'boolean') return { text: value ? m.audit.detailTrue : m.audit.detailFalse, code: null, instant: null, raw: false }
  if (typeof value === 'number') return { text: String(value), code: null, instant: null, raw: false }
  if (INSTANT_FIELDS.has(field) && isInstant(value)) return { text: fullTimeOf(value, i18n), code: null, instant: value, raw: false }
  const table: Readonly<Record<string, string>> | null =
    field === 'operationalStatus' ? m.equipment.serviceState : field === 'requiredAccessLevel' ? m.equipment.accessLevel : field === 'type' ? m.custody.type : null
  const known = table === null ? null : lookup(table, value)
  if (known !== null) return { text: known, code: value, instant: null, raw: false }
  return { text: value, code: null, instant: null, raw: !PLAIN_FIELDS.has(field) }
}

type Side = { readonly value: AuditDetailValue } | null

interface WindowSide {
  dayOfWeek?: AuditDetailValue
  enabled?: AuditDetailValue
  opensAt?: AuditDetailValue
  closesAt?: AuditDetailValue
}

type Group =
  | { readonly kind: 'row'; readonly key: string; readonly label: string | null; readonly field: string; readonly value: AuditDetailValue }
  | { readonly kind: 'change'; readonly key: string; readonly field: string; before: Side; after: Side }
  | { readonly kind: 'list'; readonly key: string; readonly values: AuditDetailValue[] }
  | { readonly kind: 'window'; readonly key: string; before: WindowSide | null; after: WindowSide | null }
  | { readonly kind: 'legacy'; readonly key: string; readonly value: AuditDetailValue }

const WINDOW_PATH = /^(before|after)\.windows\[(\d+)\]\.(dayOfWeek|enabled|opensAt|closesAt)$/
const CHANGE_PATH = /^changes\.([^.[\]]+)\.(from|to)$/
const PAIR_PATH = /^(from|to|before|after)\.([^.[\]]+)$/
const SCOPED_PATH = /^(created|revoked|assigned)\.([^.[\]]+)$/
const LIST_PATH = /^(endedOperationIds)\[\d+\]$/

/**
 * The details of an event as read-only items (D9, 09 §19.1). Top-level scalars read as before. Nested leaves are
 * grouped by what they say: `changes.X.{from,to}` is one change of X, `from.*`/`to.*` and `before.*`/`after.*` pair
 * their fields, schedule windows are one item per day, `created.*`, `revoked.*` and `assigned.*` name their scope, and
 * a list of identifiers is one item. A path off the allowlist never reaches here (the parser counted it).
 */
export function detailItems(details: AuditDetails, i18n: I18n): readonly DetailItem[] {
  const { m } = i18n
  const labels = fieldLabels(i18n)
  const scope: Readonly<Record<string, string>> = {
    created: m.audit.detailKey.created ?? 'created',
    revoked: m.audit.detailKey.revoked ?? 'revoked',
    assigned: m.audit.detailKey.assigned ?? 'assigned',
  }
  const groups = new Map<string, Group>()
  const field = (name: string) => lookup(labels, name)

  // The allowlisted leaves are read in the allowlist's order, in the slots they occupy; any other entry keeps its place.
  const entries = [...details.entries]
  const slots = entries.flatMap(([key], index) => (leafRank(key) >= 0 ? [index] : []))
  const sorted = slots.map((index) => entries[index]!).sort(([a], [b]) => leafRank(a) - leafRank(b))
  slots.forEach((slot, at) => {
    entries[slot] = sorted[at]!
  })

  for (const [key, value] of entries) {
    if (!isAllowlistedLeaf(key)) {
      groups.set(key, { kind: 'legacy', key, value })
      continue
    }
    const window = WINDOW_PATH.exec(key)
    const change = CHANGE_PATH.exec(key)
    const pair = PAIR_PATH.exec(key)
    const scoped = SCOPED_PATH.exec(key)
    const list = LIST_PATH.exec(key)
    if (window !== null) {
      const [, side, index, part] = window as unknown as [string, 'before' | 'after', string, keyof WindowSide]
      // Windows are matched by their day, so a day that moved between two versions still pairs with itself.
      const day = (details.entries.find(([k]) => k === `${side}.windows[${index}].dayOfWeek`)?.[1] ?? `#${index}`) as string
      const id = `windows:${String(day)}`
      const existing = groups.get(id)
      const group: Extract<Group, { kind: 'window' }> = existing?.kind === 'window' ? existing : { kind: 'window', key: id, before: null, after: null }
      group[side] = group[side] ?? {}
      group[side][part] = value
      groups.set(id, group)
    } else if (change !== null) {
      const [, name, end] = change as unknown as [string, string, 'from' | 'to']
      const id = `changes.${name}`
      const existing = groups.get(id)
      const group: Extract<Group, { kind: 'change' }> = existing?.kind === 'change' ? existing : { kind: 'change', key: id, field: name, before: null, after: null }
      if (end === 'from') group.before = { value }
      else group.after = { value }
      groups.set(id, group)
    } else if (pair !== null) {
      const [, side, name] = pair as unknown as [string, 'from' | 'to' | 'before' | 'after', string]
      const base = side === 'from' || side === 'to' ? 'placement' : 'schedule'
      const id = `${base}.${name}`
      const existing = groups.get(id)
      const group: Extract<Group, { kind: 'change' }> = existing?.kind === 'change' ? existing : { kind: 'change', key: id, field: name, before: null, after: null }
      if (side === 'from' || side === 'before') group.before = { value }
      else group.after = { value }
      groups.set(id, group)
    } else if (scoped !== null) {
      const [, prefix, name] = scoped as unknown as [string, string, string]
      const named = field(name)
      groups.set(key, { kind: 'row', key, field: name, value, label: `${scope[prefix] ?? prefix} · ${named ?? name}` })
    } else if (list !== null) {
      const id = list[1] ?? key
      const existing = groups.get(id)
      const group: Extract<Group, { kind: 'list' }> = existing?.kind === 'list' ? existing : { kind: 'list', key: id, values: [] }
      group.values.push(value)
      groups.set(id, group)
    } else {
      groups.set(key, { kind: 'legacy', key, value })
    }
  }

  const missing: DetailValueView = { text: m.audit.detailNull, code: null, instant: null, raw: false }
  /** A side the server did not send at all (no placement before the first one, no schedule before the first one). */
  const absent: DetailValueView = { text: m.audit.detailAbsent, code: null, instant: null, raw: false }
  const windowText = (window: WindowSide | null): DetailValueView => {
    if (window === null) return absent
    if (typeof window.enabled !== 'boolean') return missing
    if (!window.enabled) return { text: m.schedule.closed, code: null, instant: null, raw: false }
    const time = (value: AuditDetailValue | undefined) => (typeof value === 'string' ? formatTimeOfDay(value) : m.audit.detailNull)
    return { text: `${time(window.opensAt)} – ${time(window.closesAt)}`, code: null, instant: null, raw: false }
  }
  const sideView = (name: string, side: Side) => (side === null ? absent : valueView(name, side.value, i18n))

  const items: DetailItem[] = []
  for (const group of groups.values()) {
    switch (group.kind) {
      case 'legacy': {
        const [row] = detailRows({ entries: [[group.key, group.value]], omitted: 0 }, i18n)
        if (row !== undefined) items.push({ kind: 'row', id: row.key, key: row.key, label: row.label, value: { text: row.text, code: row.code, instant: row.instant, raw: row.raw } })
        break
      }
      case 'row':
        items.push({ kind: 'row', id: group.key, key: group.key, label: group.label, value: valueView(group.field, group.value, i18n) })
        break
      case 'change':
        items.push({ kind: 'change', id: group.key, key: group.key, label: field(group.field), before: sideView(group.field, group.before), after: sideView(group.field, group.after) })
        break
      case 'list':
        items.push({ kind: 'list', id: group.key, key: group.key, label: field(group.key), values: group.values.map((value) => valueView(group.key, value, i18n)) })
        break
      case 'window': {
        const day = group.key.slice('windows:'.length)
        items.push({ kind: 'change', id: group.key, key: group.key, label: lookup(m.schedule.day, day) ?? day, before: windowText(group.before), after: windowText(group.after) })
        break
      }
    }
  }
  return items
}
