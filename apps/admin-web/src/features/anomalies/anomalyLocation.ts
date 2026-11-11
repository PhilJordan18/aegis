import { ANOMALY_TYPES, type AnomalySeverity, type AnomalyStatus, type AnomalyType } from './contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The API reads `page` as a Java int: a larger index is a 400, not a page past the end. */
const MAX_PAGE_INDEX = 2_147_483_647

export const ANOMALY_PAGE_SIZE = 20

export interface AnomalyFilters {
  /** null: every status. */
  readonly status: AnomalyStatus | null
  readonly severity: AnomalySeverity | null
  readonly type: AnomalyType | null
}

export interface AnomalyLocation {
  readonly filters: AnomalyFilters
  /** Zero-based; one-based in the address. */
  readonly page: number
  readonly anomalyId: string | null
}

const STATUS_PARAM: Record<AnomalyStatus, string> = { OPEN: 'ouvertes', ACKNOWLEDGED: 'reconnues', RESOLVED: 'resolues' }
const SEVERITY_PARAM: Record<AnomalySeverity, string> = { HIGH: 'elevee', MEDIUM: 'moyenne', LOW: 'faible' }
const ALL = 'toutes'

function invert<T extends string>(table: Record<T, string>, value: string | null): T | null {
  return (Object.keys(table) as T[]).find((key) => table[key] === value) ?? null
}

/**
 * `?statut=reconnues&gravite=elevee&type=COMMAND_REJECTED&page=2&anomalie=<id>`. The default filter is « Ouvertes »
 * (triage: what needs an action first), except when the address names an anomaly: it then lists every status, so
 * the named anomaly is not hidden by a filter it does not match. An unusable value is ignored.
 */
export function readAnomalyLocation(search: string): AnomalyLocation {
  const params = new URLSearchParams(search)
  const id = params.get('anomalie')
  const anomalyId = id !== null && UUID.test(id) ? id.toLowerCase() : null
  const statusParam = params.get('statut')
  const status = statusParam === ALL ? null : (invert(STATUS_PARAM, statusParam) ?? (anomalyId === null ? 'OPEN' : null))
  const type = params.get('type')
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return {
    filters: {
      status,
      severity: invert(SEVERITY_PARAM, params.get('gravite')),
      type: (ANOMALY_TYPES as readonly string[]).includes(type ?? '') ? (type as AnomalyType) : null,
    },
    page: Number.isInteger(page) && page >= 1 && page - 1 <= MAX_PAGE_INDEX ? page - 1 : 0,
    anomalyId,
  }
}

/** The inverse of `readAnomalyLocation`: the status is written whenever the default would not give it back. */
export function anomaliesHref({ filters, page, anomalyId }: AnomalyLocation): string {
  const params = new URLSearchParams()
  const defaultStatus: AnomalyStatus | null = anomalyId === null ? 'OPEN' : null
  if (filters.status !== defaultStatus) params.set('statut', filters.status === null ? ALL : STATUS_PARAM[filters.status])
  if (filters.severity !== null) params.set('gravite', SEVERITY_PARAM[filters.severity])
  if (filters.type !== null) params.set('type', filters.type)
  if (page > 0) params.set('page', String(page + 1))
  if (anomalyId !== null) params.set('anomalie', anomalyId)
  const query = params.toString()
  return query === '' ? '/anomalies' : `/anomalies?${query}`
}

/** « Ouvertes » is a filter: an empty list under it never says that there is no record. */
export function hasActiveFilter(filters: AnomalyFilters): boolean {
  return filters.status !== null || filters.severity !== null || filters.type !== null
}

export const NO_FILTERS: AnomalyFilters = { status: null, severity: null, type: null }
