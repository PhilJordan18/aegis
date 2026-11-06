import { describe, expect, it } from 'vitest'
import { parseOperatingScheduleView } from './contractParsers'
import { scheduleView } from './testFixtures'

describe('parseOperatingScheduleView', () => {
  it('accepts the contract as the server sends it', () => {
    expect(parseOperatingScheduleView(scheduleView())).toEqual(scheduleView())
  })

  it.each([
    ['six days', { windows: scheduleView().windows.slice(0, 6) }],
    ['days out of order', { windows: [...scheduleView().windows].reverse() }],
    ['a time without seconds', { windows: scheduleView().windows.map((w, i) => (i === 0 ? { ...w, opensAt: '07:00' } : w)) }],
    ['an impossible hour', { windows: scheduleView().windows.map((w, i) => (i === 0 ? { ...w, closesAt: '24:00:00' } : w)) }],
    ['an empty zone', { timeZone: '' }],
  ])('refuses %s', (_, overrides) => {
    expect(parseOperatingScheduleView({ ...scheduleView(), ...overrides })).toBeNull()
  })

  it('refuses a missing enabled flag', () => {
    const windows = scheduleView().windows.map((w, i) => (i === 2 ? { dayOfWeek: w.dayOfWeek, opensAt: w.opensAt, closesAt: w.closesAt } : w))
    expect(parseOperatingScheduleView({ ...scheduleView(), windows })).toBeNull()
  })
})
