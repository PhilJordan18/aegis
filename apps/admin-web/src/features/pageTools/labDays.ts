import { LAB_TIME_ZONE } from '../catalog/assetPresentation'

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: LAB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** Today in the laboratory zone, as `YYYY-MM-DD`; never the browser's zone. */
export function labToday(now: Date = new Date()): string {
  return dayFormat.format(now)
}

/** `day` moved by `offset` calendar days (no zone involved: a calendar day has no instant). */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** « Aujourd'hui », « 7 jours », « 30 jours »: both bounds inclusive, ending today. */
export function lastDays(count: number, now: Date = new Date()): { readonly from: string; readonly to: string } {
  const to = labToday(now)
  return { from: shiftDay(to, 1 - count), to }
}

/** « 10 nov. » for a calendar day: the day as written, at noon UTC so no zone moves it. */
export function shortDay(day: string, formatLocale: string): string {
  return new Intl.DateTimeFormat(formatLocale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`))
}
