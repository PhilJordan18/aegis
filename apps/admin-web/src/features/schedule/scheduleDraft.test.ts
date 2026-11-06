import { describe, expect, it } from 'vitest'
import { draftOf, fieldOf, requestOf } from './scheduleDraft'
import { scheduleView } from './testFixtures'

describe('scheduleDraft', () => {
  it('starts with every day closed and the suggested zone when nothing is configured', () => {
    const draft = draftOf(null, 'America/Toronto')
    expect(draft.timeZone).toBe('America/Toronto')
    expect(draft.days.map((day) => day.enabled)).toEqual([false, false, false, false, false, false, false])
  })

  it('round-trips a saved schedule unchanged, so an untouched save is the server no-op', () => {
    const saved = scheduleView()
    const { request, errors } = requestOf(draftOf(saved, 'Europe/Paris'))
    expect(errors).toEqual({})
    expect(request).toEqual({ timeZone: saved.timeZone, windows: saved.windows })
  })

  it('shows minutes only, but keeps seconds that are not zero', () => {
    const windows = scheduleView().windows.map((w, i) => (i === 0 ? { ...w, opensAt: '07:30:15' } : w))
    const draft = draftOf(scheduleView({ windows }), '')
    expect(draft.days[0]).toMatchObject({ opensAt: '07:30:15', closesAt: '18:00' })
    expect(requestOf(draft).request.windows[0]).toMatchObject({ opensAt: '07:30:15', closesAt: '18:00:00' })
  })

  it('sends null times for a closed day, even when the draft remembers them', () => {
    const draft = draftOf(scheduleView(), '')
    const closedMonday = { ...draft, days: draft.days.map((day, i) => (i === 0 ? { ...day, enabled: false } : day)) }
    expect(requestOf(closedMonday).request.windows[0]).toEqual({ dayOfWeek: 'MONDAY', enabled: false, opensAt: null, closesAt: null })
  })

  it('reports missing times, a closing not after the opening and an empty zone on their server fields', () => {
    const draft = draftOf(scheduleView(), '')
    const broken = {
      timeZone: '  ',
      days: draft.days.map((day, i) => (i === 0 ? { ...day, opensAt: '' } : i === 1 ? { ...day, opensAt: '18:00', closesAt: '18:00' } : day)),
    }
    expect(requestOf(broken).errors).toEqual({ timeZone: 'required', [fieldOf(0, 'opensAt')]: 'required', [fieldOf(1, 'closesAt')]: 'notAfterOpensAt' })
  })
})
