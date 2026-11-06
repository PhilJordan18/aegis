import { DAYS, type DayOfWeek, type OperatingScheduleView, type OperatingWindow } from './contract'

const TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isTime = (value: unknown): value is string | null => value === null || (typeof value === 'string' && TIME.test(value))

function parseWindow(value: unknown, day: DayOfWeek): OperatingWindow | null {
  if (!isRecord(value) || value.dayOfWeek !== day || typeof value.enabled !== 'boolean') return null
  if (!isTime(value.opensAt) || !isTime(value.closesAt)) return null
  return { dayOfWeek: day, enabled: value.enabled, opensAt: value.opensAt, closesAt: value.closesAt }
}

/** Strict: exactly seven days, MONDAY to SUNDAY in order, `HH:mm:ss` or null. Anything else is not the contract. */
export function parseOperatingScheduleView(body: unknown): OperatingScheduleView | null {
  if (!isRecord(body) || !Array.isArray(body.windows) || body.windows.length !== DAYS.length) return null
  const { id, lockerId, timeZone, createdAt, createdByUserId } = body
  if (!isText(id) || !isText(lockerId) || !isText(timeZone) || !isText(createdAt) || !isText(createdByUserId)) return null
  const windows: OperatingWindow[] = []
  for (const [index, day] of DAYS.entries()) {
    const window = parseWindow(body.windows[index], day)
    if (window === null) return null
    windows.push(window)
  }
  return { id, lockerId, timeZone, createdAt, createdByUserId, windows }
}
