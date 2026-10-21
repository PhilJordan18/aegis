import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from './session'
import { adminProfile, technicianProfile } from './testFixtures'

const TOKEN = 'secret-test-token-value'

describe('createSessionStore', () => {
  const writes: string[] = []

  beforeEach(() => {
    writes.length = 0
    localStorage.clear()
    sessionStorage.clear()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string) {
      writes.push(`storage:${key}`)
    })
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
      writes.push(`cookie:${value}`)
      cookie?.set?.call(document, value)
    })
    vi.stubGlobal('indexedDB', {
      open: () => {
        writes.push('indexedDB')
        throw new Error('IndexedDB must not be used')
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the token in memory only, through the whole lifecycle', () => {
    const store = createSessionStore()
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    expect(store.getAccessToken()).toBe(TOKEN)
    store.end('sessionExpired')
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    store.signOut()

    expect(writes).toEqual([])
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('never exposes the token in the React snapshot', () => {
    const store = createSessionStore()
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    expect(store.getSnapshot()).toEqual({ status: 'authenticated', profile: adminProfile, expiresAt: '2026-09-30T15:30:00Z' })
    expect(JSON.stringify(store.getSnapshot())).not.toContain(TOKEN)
  })

  it('refuses to keep a non-administrator session', () => {
    const store = createSessionStore()
    expect(() => store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: technicianProfile })).toThrow()
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })
  })

  it('drops the token and records why the session ended', () => {
    const store = createSessionStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    store.end('sessionInvalid')
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionInvalid', email: adminProfile.email })
    store.acknowledgeArrival()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: null, email: null })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('accepts an explicit email to prefill after a session ends', () => {
    const store = createSessionStore()
    store.end('sessionExpired', 'admin@aegis.demo')
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionExpired', email: 'admin@aegis.demo' })
  })

  it('signs out locally', () => {
    const store = createSessionStore()
    store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
    store.signOut()
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })
  })

  describe('expiry (09 §4.1: no refresh)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('ends the session as expired once the token lifetime has elapsed since receipt, keeping the email', () => {
      const store = createSessionStore()
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
      vi.advanceTimersByTime(3600 * 1000 - 1)
      expect(store.getSnapshot().status).toBe('authenticated')
      vi.advanceTimersByTime(1)
      expect(store.getAccessToken()).toBeNull()
      expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'sessionExpired', email: adminProfile.email })
    })

    it('ignores the browser clock: expiresAt in the past does not end a fresh session', () => {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const store = createSessionStore()
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
      vi.advanceTimersByTime(60_000)
      expect(store.getSnapshot().status).toBe('authenticated')
    })

    it('cancels the expiry of a session that ended earlier or was replaced', () => {
      const store = createSessionStore()
      store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      store.signOut()
      vi.advanceTimersByTime(120_000)
      expect(store.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })

      store.start({ accessToken: 'first', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      vi.advanceTimersByTime(30_000)
      store.start({ accessToken: 'second', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 60, profile: adminProfile })
      vi.advanceTimersByTime(45_000)
      expect(store.getAccessToken()).toBe('second')
      vi.advanceTimersByTime(15_000)
      expect(store.getAccessToken()).toBeNull()
    })

    it('refuses a session without a positive lifetime', () => {
      const store = createSessionStore()
      for (const expiresIn of [0, -1, Number.NaN]) {
        expect(() => store.start({ accessToken: TOKEN, expiresAt: '2026-09-30T15:30:00Z', expiresIn, profile: adminProfile })).toThrow()
      }
      expect(store.getAccessToken()).toBeNull()
    })
  })

  it('keeps snapshots stable between changes for useSyncExternalStore', () => {
    const store = createSessionStore()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    store.acknowledgeArrival()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
})
