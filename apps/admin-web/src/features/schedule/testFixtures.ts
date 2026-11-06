import { DAYS, type OperatingScheduleView, type OperatingWindow } from './contract'

export const SCHEDULE_ID = '7c1e2d34-5f60-4a71-8b92-a3b4c5d6e7f8'
export const ADMIN_ID = '0b9d6a0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e'

/** Weekdays 07:00–18:00, weekend closed, in Toronto. */
export function scheduleView(overrides: Partial<OperatingScheduleView> = {}, lockerId = 'd46a74ae-39dc-460b-8af0-38fc791b376a'): OperatingScheduleView {
  const windows: OperatingWindow[] = DAYS.map((dayOfWeek, index) =>
    index < 5 ? { dayOfWeek, enabled: true, opensAt: '07:00:00', closesAt: '18:00:00' } : { dayOfWeek, enabled: false, opensAt: null, closesAt: null },
  )
  return { id: SCHEDULE_ID, lockerId, timeZone: 'America/Toronto', createdAt: '2026-11-06T14:00:00Z', createdByUserId: ADMIN_ID, windows, ...overrides }
}
