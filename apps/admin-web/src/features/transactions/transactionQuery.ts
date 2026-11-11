import { resolveZonedInput } from '../../i18n/zonedTime'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import type { TransactionFilterValues } from './transactionHref'

/**
 * The instant at which a laboratory calendar day starts, as an RFC 3339 instant; null when the zone has no such
 * midnight (then the next hour starts the day). The `earlier` of a repeated wall time is the start of the day.
 */
function startOfDay(day: string): string | null {
  for (const time of ['00:00', '01:00']) {
    const resolved = resolveZonedInput(`${day}T${time}`, LAB_TIME_ZONE)
    if (resolved.kind === 'exact') return resolved.instant
    if (resolved.kind === 'ambiguous') return resolved.earlier
  }
  return null
}

function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)
}

/**
 * `from` is inclusive and `to` exclusive in the API (09 §17): « Au » names a day that is itself included, so the
 * bound sent is the start of the day after it. Days are read in the laboratory zone, never the browser's.
 */
export function periodInstants(filters: Pick<TransactionFilterValues, 'from' | 'to'>): { readonly from?: string; readonly to?: string } {
  const from = filters.from === null ? null : startOfDay(filters.from)
  const to = filters.to === null ? null : startOfDay(nextDay(filters.to))
  return { ...(from === null ? {} : { from }), ...(to === null ? {} : { to }) }
}
