import { DAYS, type DayOfWeek, type OperatingScheduleRequest, type OperatingScheduleView } from './contract'

export interface DayDraft {
  readonly dayOfWeek: DayOfWeek
  readonly enabled: boolean
  /** `HH:mm` or `HH:mm:ss` from `<input type="time">`; kept while the day is closed, so reopening restores it. */
  readonly opensAt: string
  readonly closesAt: string
}

export interface ScheduleDraft {
  readonly timeZone: string
  readonly days: readonly DayDraft[]
}

/** Field keys follow the server's violation paths (09 §7.1): `timeZone`, `windows[i].opensAt`… */
export const fieldOf = (index: number, part: 'opensAt' | 'closesAt' | 'dayOfWeek' | 'enabled') => `windows[${index}].${part}`

/** Trailing `:00` seconds are not shown; other seconds are kept, so an unchanged time is sent back as it came. */
const shown = (time: string | null) => (time === null ? '' : time.endsWith(':00') ? time.slice(0, 5) : time)
const sent = (time: string) => (time.length === 5 ? `${time}:00` : time)

/**
 * The draft of the editor. Without an active schedule the days start closed and the zone empty unless a
 * suggestion is given: nothing is saved until the administrator submits.
 */
export function draftOf(schedule: OperatingScheduleView | null, suggestedZone: string): ScheduleDraft {
  if (schedule === null) return { timeZone: suggestedZone, days: DAYS.map((dayOfWeek) => ({ dayOfWeek, enabled: false, opensAt: '', closesAt: '' })) }
  return {
    timeZone: schedule.timeZone,
    days: schedule.windows.map((window) => ({ dayOfWeek: window.dayOfWeek, enabled: window.enabled, opensAt: shown(window.opensAt), closesAt: shown(window.closesAt) })),
  }
}

export type LocalViolation = 'required' | 'notAfterOpensAt'

/**
 * Anticipates the rules of one day (an open day has both times, closing after opening, 09 §13.2); the zone and
 * everything else are the server's to judge. A closed day sends null times, whatever the draft keeps.
 */
export function requestOf(draft: ScheduleDraft): { request: OperatingScheduleRequest; errors: Record<string, LocalViolation> } {
  const errors: Record<string, LocalViolation> = {}
  const timeZone = draft.timeZone.trim()
  if (timeZone === '') errors.timeZone = 'required'
  const windows = draft.days.map((day, index) => {
    if (!day.enabled) return { dayOfWeek: day.dayOfWeek, enabled: false, opensAt: null, closesAt: null }
    if (day.opensAt === '') errors[fieldOf(index, 'opensAt')] = 'required'
    if (day.closesAt === '') errors[fieldOf(index, 'closesAt')] = 'required'
    const opensAt = day.opensAt === '' ? null : sent(day.opensAt)
    const closesAt = day.closesAt === '' ? null : sent(day.closesAt)
    // `HH:mm:ss` strings compare in time order.
    if (opensAt !== null && closesAt !== null && closesAt <= opensAt) errors[fieldOf(index, 'closesAt')] = 'notAfterOpensAt'
    return { dayOfWeek: day.dayOfWeek, enabled: true, opensAt, closesAt }
  })
  return { request: { timeZone, windows }, errors }
}
