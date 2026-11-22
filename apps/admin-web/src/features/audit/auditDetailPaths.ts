import type { AuditDetails, AuditDetailValue } from './contract'

/**
 * The nested paths of the filtered `details` (09 §19.1, AuditDetailsFilter): the server keeps the nesting of an event's
 * details and a scalar leaf only where its full path is on an allowlist; `[]` stands for every element of a list. This
 * is the union of those paths over every event type, written once here so that the client reads exactly what the
 * server can send and nothing else. A path is a pattern: `windows[0].opensAt` is read as `windows[].opensAt`.
 */
const MODEL_FIELDS = ['name', 'manufacturer', 'modelNumber', 'defaultCalibrationRequired']
const ASSET_FIELDS = ['assetModelId', 'assetCode', 'serialNumber', 'requiredAccessLevel', 'operationalStatus', 'calibrationRequired', 'calibrationDueAt']
const IDENTIFIER_FIELDS = ['assetId', 'type']
const PLACEMENT_FIELDS = ['placementId', 'lockerId', 'lockerCode', 'compartmentId', 'compartmentCode', 'assignedAt']
const SCHEDULE_FIELDS = ['timeZone', 'windows[].dayOfWeek', 'windows[].enabled', 'windows[].opensAt', 'windows[].closesAt']

const under = (scope: string, fields: readonly string[]) => fields.map((field) => `${scope}.${field}`)

/** The catalog fields an update may change; each is sent as `changes.<field>.from` and `changes.<field>.to`. */
export const CHANGED_FIELDS: readonly string[] = [...MODEL_FIELDS, ...ASSET_FIELDS]

/** In the order the screen reads them: the server's own key order is not stable (a `to` can precede its `from`). */
const LEAF_LIST: readonly string[] = [
  ...under('created', CHANGED_FIELDS),
  ...CHANGED_FIELDS.flatMap((field) => [`changes.${field}.from`, `changes.${field}.to`]),
  ...under('revoked', IDENTIFIER_FIELDS),
  ...under('assigned', IDENTIFIER_FIELDS),
  ...under('from', PLACEMENT_FIELDS),
  ...under('to', PLACEMENT_FIELDS),
  ...under('before', SCHEDULE_FIELDS),
  ...under('after', SCHEDULE_FIELDS),
  'endedOperationIds[]',
]

const LEAVES: ReadonlySet<string> = new Set(LEAF_LIST)
const LEAF_RANK: ReadonlyMap<string, number> = new Map(LEAF_LIST.map((leaf, index) => [leaf, index]))

/** The reading order of an allowlisted path, or -1 for any other. */
export const leafRank = (path: string) => LEAF_RANK.get(patternOf(path)) ?? -1

/** Every proper prefix of a leaf pattern: the containers that may be walked into. */
const CONTAINERS: ReadonlySet<string> = (() => {
  const prefixes = new Set<string>()
  for (const leaf of LEAVES) {
    for (let dot = leaf.indexOf('.'); dot >= 0; dot = leaf.indexOf('.', dot + 1)) {
      const prefix = leaf.slice(0, dot)
      prefixes.add(prefix)
      if (prefix.endsWith('[]')) prefixes.add(prefix.slice(0, -2))
    }
  }
  return prefixes
})()

/** True for a path of the allowlist, with list positions written as numbers (`windows[3].opensAt`). */
export const isAllowlistedLeaf = (path: string) => LEAVES.has(patternOf(path))

/** `windows[3].opensAt` to `windows[].opensAt`. */
export const patternOf = (path: string) => path.replace(/\[\d+\]/g, '[]')

/** Bounds: the largest allowlisted path has four levels (`after.windows[].opensAt`); a schedule sends 58 leaves. */
const MAX_DEPTH = 5
const MAX_LEAVES = 200
const MAX_LIST = 100

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/**
 * D9 and 09 §19.1: the scalar leaves of `details`, as dotted paths (`changes.operationalStatus.to`) in the order sent.
 *
 * - A scalar at the top level is kept under its key, as before.
 * - A nested scalar is kept only at an allowlisted path; an object or a list is walked only when it is on a path that
 *   leads to one. Anything else (an unknown key, a structure on a scalar path, a depth or size beyond the bounds) is
 *   counted and never read or rendered. An empty container is nothing to show and is not counted.
 */
export function flattenAuditDetails(details: Readonly<Record<string, unknown>>): AuditDetails {
  const entries: [string, AuditDetailValue][] = []
  let omitted = 0

  const keep = (path: string, value: AuditDetailValue) => {
    if (entries.length < MAX_LEAVES) entries.push([path, value])
    else omitted += 1
  }

  const walk = (path: string, pattern: string, value: unknown, depth: number) => {
    // `to: null` is how a placement says that there is none: a null on a name that leads a container is nothing to show.
    if (depth === 0 && value === null && CONTAINERS.has(pattern)) return
    if (depth === 0 && (value === null || isScalar(value))) return keep(path, value)
    if (value === null) {
      // A null leaf is a value (a calibration date that was cleared); a null where a container may stand is nothing.
      if (LEAVES.has(pattern)) keep(path, null)
      else if (!CONTAINERS.has(pattern)) omitted += 1
      return
    }
    if (isScalar(value)) {
      if (LEAVES.has(pattern)) keep(path, value)
      else omitted += 1
      return
    }
    if (depth >= MAX_DEPTH) {
      omitted += 1
      return
    }
    if (Array.isArray(value)) {
      const elements = `${pattern}[]`
      if (!LEAVES.has(elements) && !CONTAINERS.has(elements)) {
        omitted += 1
        return
      }
      value.slice(0, MAX_LIST).forEach((item, index) => walk(`${path}[${index}]`, elements, item, depth + 1))
      omitted += Math.max(0, value.length - MAX_LIST)
      return
    }
    if (typeof value === 'object') {
      if (!CONTAINERS.has(pattern)) {
        omitted += 1
        return
      }
      for (const [key, nested] of Object.entries(value)) walk(`${path}.${key}`, `${pattern}.${key}`, nested, depth + 1)
      return
    }
    omitted += 1
  }

  for (const [key, value] of Object.entries(details)) walk(key, key, value, 0)
  return { entries, omitted }
}
