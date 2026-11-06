/** Operating schedule of a locker (09 §13): one immutable version, seven days from MONDAY to SUNDAY. */
export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
export type DayOfWeek = (typeof DAYS)[number]

export interface OperatingWindow {
  readonly dayOfWeek: DayOfWeek
  readonly enabled: boolean
  /** Local time `HH:mm:ss`, null when the day is closed. */
  readonly opensAt: string | null
  readonly closesAt: string | null
}

export interface OperatingScheduleView {
  readonly id: string
  readonly lockerId: string
  /** IANA identifier, as stored. */
  readonly timeZone: string
  readonly createdAt: string
  readonly createdByUserId: string
  readonly windows: readonly OperatingWindow[]
}

/** `PUT` body (09 §13.2). No `Idempotency-Key`: an identical PUT creates nothing (§20.2). */
export interface OperatingScheduleRequest {
  readonly timeZone: string
  readonly windows: readonly OperatingWindow[]
}
