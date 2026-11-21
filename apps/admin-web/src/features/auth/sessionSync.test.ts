import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { clearCacheOnSessionChange } from '../../api/serverState'
import type { GatewayResult } from './authGateway'
import type { LoginResponse } from './contract'
import { createSessionStore, type SessionTransport } from './session'
import { connectSessionSignals, createSessionSignals, SIGNAL_STORAGE_KEY, type SignalWindow } from './sessionSync'
import { adminProfile, httpProblem, loginOk, problemBody } from './testFixtures'

/** Same-process stand-ins for the browser: tabs of one browser share the bus (channel) or the storage (events). */
class Bus {
  readonly channels = new Set<FakeChannel>()
}
class FakeChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  readonly name: string
  private readonly bus: Bus
  constructor(name: string, bus: Bus) {
    this.name = name
    this.bus = bus
    bus.channels.add(this)
  }
  postMessage(data: unknown) {
    for (const other of this.bus.channels) if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent<unknown>)
  }
  close() {
    this.bus.channels.delete(this)
  }
}

function channelWindow(bus: Bus): SignalWindow {
  return {
    BroadcastChannel: class extends FakeChannel {
      constructor(name: string) {
        super(name, bus)
      }
    } as unknown as typeof BroadcastChannel,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
}

/** Tabs without BroadcastChannel: a write is a `storage` event in every other tab, never in the writing one. */
class SharedStorage {
  readonly written: string[] = []
  readonly tabs = new Set<(event: StorageEvent) => void>()
  private readonly items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  window(blocked = false): SignalWindow {
    let self: ((event: StorageEvent) => void) | null = null
    const storage = {
      setItem: (key: string, value: string) => {
        if (blocked) throw new DOMException('blocked', 'SecurityError')
        this.written.push(`${key}=${value}`)
        this.items.set(key, value)
        for (const tab of this.tabs) if (tab !== self) tab({ key, newValue: value } as StorageEvent)
      },
      removeItem: (key: string) => {
        this.items.delete(key)
        for (const tab of this.tabs) if (tab !== self) tab({ key, newValue: null } as StorageEvent)
      },
    } as unknown as Storage
    return {
      localStorage: storage,
      addEventListener: (_type, listener) => {
        self = listener
        this.tabs.add(listener)
      },
      removeEventListener: (_type, listener) => {
        this.tabs.delete(listener)
      },
    }
  }
}

describe('createSessionSignals', () => {
  it('tells the other tabs, not itself, over a BroadcastChannel', () => {
    const bus = new Bus()
    const a = createSessionSignals(channelWindow(bus))
    const b = createSessionSignals(channelWindow(bus))
    const heardByA = vi.fn()
    const heardByB = vi.fn()
    a.subscribe(heardByA)
    b.subscribe(heardByB)
    a.post('signedOut')
    b.post('signedIn')
    expect(heardByB.mock.calls).toEqual([['signedOut']])
    expect(heardByA.mock.calls).toEqual([['signedIn']])
  })

  it('ignores a message that is not one of the two signals', () => {
    const bus = new Bus()
    const receiver = createSessionSignals(channelWindow(bus))
    const heard = vi.fn()
    receiver.subscribe(heard)
    const intruder = new FakeChannel('aegis.manager.session', bus)
    for (const payload of ['token=abc', { signal: 'signedOut' }, null, 42, 'signedOut ']) intruder.postMessage(payload)
    expect(heard).not.toHaveBeenCalled()
  })

  it('stops delivering once closed', () => {
    const bus = new Bus()
    const a = createSessionSignals(channelWindow(bus))
    const b = createSessionSignals(channelWindow(bus))
    const heard = vi.fn()
    b.subscribe(heard)
    b.close()
    a.post('signedOut')
    expect(heard).not.toHaveBeenCalled()
  })

  it('falls back to a storage event that carries only the signal name, and leaves nothing in storage', () => {
    const shared = new SharedStorage()
    const a = createSessionSignals(shared.window())
    const b = createSessionSignals(shared.window())
    const heardByA = vi.fn()
    const heardByB = vi.fn()
    a.subscribe(heardByA)
    b.subscribe(heardByB)

    a.post('signedOut')
    expect(heardByB.mock.calls).toEqual([['signedOut']])
    expect(heardByA).not.toHaveBeenCalled()
    expect(shared.written).toHaveLength(1)
    expect(shared.written[0]).toMatch(new RegExp(`^${SIGNAL_STORAGE_KEY.replaceAll('.', '\\.')}=(signedOut|signedIn):[a-z0-9]+$`))
    expect(shared.length).toBe(0)
  })

  it('does nothing, and does not throw, when storage is blocked', () => {
    const shared = new SharedStorage()
    const blocked = createSessionSignals(shared.window(true))
    const other = createSessionSignals(shared.window())
    const heard = vi.fn()
    other.subscribe(heard)
    expect(() => blocked.post('signedOut')).not.toThrow()
    expect(heard).not.toHaveBeenCalled()
  })
})

const revoked: GatewayResult<true> = { kind: 'ok', value: true, requestId: null }
const OTHER_ACCOUNT = { ...adminProfile, id: '00000000-0000-4000-8000-0000000000b2', email: 'autre@aegis.test', displayName: 'Autre Administrateur' }

function tab(transport: Partial<SessionTransport> = {}) {
  const session = createSessionStore()
  session.connect({ refreshSession: vi.fn(async () => loginOk(adminProfile, 'restored')), revokeSession: vi.fn(async () => revoked), ...transport })
  const queryClient = new QueryClient()
  clearCacheOnSessionChange(queryClient, session)
  return { session, queryClient }
}

function twoTabs(first: Partial<SessionTransport> = {}, second: Partial<SessionTransport> = {}) {
  const bus = new Bus()
  const a = tab(first)
  const b = tab(second)
  connectSessionSignals(a.session, createSessionSignals(channelWindow(bus)))
  connectSessionSignals(b.session, createSessionSignals(channelWindow(bus)))
  return { a, b }
}

const start = (session: ReturnType<typeof createSessionStore>, profile = adminProfile, accessToken = 'token') =>
  session.start({ accessToken, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile })

describe('tab coordination', () => {
  it('a confirmed sign-out in one tab drops the token of the others and clears their data', async () => {
    const { a, b } = twoTabs()
    start(a.session)
    start(b.session, adminProfile, 'token-b')
    // Tab B's sign-in made tab A ask the server again (same account): wait for it to settle.
    await vi.waitFor(() => expect(a.session.getAccessToken()).toBe('restored'))
    b.queryClient.setQueryData(['assets'], ['MM-001'])

    expect(await a.session.signOut()).toBe(true)
    expect(b.session.getAccessToken()).toBeNull()
    expect(b.session.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })
    expect(b.queryClient.getQueryData(['assets'])).toBeUndefined()
  })

  it('an unconfirmed sign-out announces nothing: the other tabs keep their session', async () => {
    const { a, b } = twoTabs({ revokeSession: async () => ({ kind: 'network', reason: 'offline' }) })
    start(a.session)
    start(b.session, adminProfile, 'token-b')
    await vi.waitFor(() => expect(a.session.getAccessToken()).toBe('restored'))

    expect(await a.session.signOut()).toBe(false)
    expect(b.session.getSnapshot().status).toBe('authenticated')
    expect(b.session.getAccessToken()).toBe('token-b')
  })

  it('a sign-in as another account makes an open tab ask the server and swap, with no data of the old account left', async () => {
    const answer = loginOk(OTHER_ACCOUNT, 'token-b2')
    const { a, b } = twoTabs({}, { refreshSession: async () => answer })
    start(b.session, adminProfile, 'token-b')
    b.queryClient.setQueryData(['assets'], ['données du premier compte'])

    start(a.session, OTHER_ACCOUNT, 'token-a')
    await vi.waitFor(() => expect(b.session.getAccessToken()).toBe('token-b2'))
    expect(b.session.getSnapshot()).toMatchObject({ status: 'authenticated', profile: { id: OTHER_ACCOUNT.id } })
    expect(b.queryClient.getQueryData(['assets'])).toBeUndefined()
  })

  it('a sign-in whose browser session the server no longer knows leaves the open tab anonymous, not on the old account', async () => {
    const refused = async (): Promise<GatewayResult<LoginResponse>> => httpProblem(401, problemBody(401, 'AUTH_SESSION_INVALID'))
    const { a, b } = twoTabs({}, { refreshSession: refused })
    start(b.session, adminProfile, 'token-b')
    start(a.session, OTHER_ACCOUNT, 'token-a')
    await vi.waitFor(() => expect(b.session.getSnapshot().status).toBe('anonymous'))
    expect(b.session.getAccessToken()).toBeNull()
  })

  it('an anonymous tab ignores a sign-in and asks nothing', () => {
    const refreshSession = vi.fn(async (): Promise<GatewayResult<LoginResponse>> => loginOk(adminProfile))
    const { a, b } = twoTabs({}, { refreshSession })
    start(a.session)
    expect(b.session.getSnapshot().status).toBe('anonymous')
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('a sign-out reaching a tab that is still restoring discards the answer of its refresh', async () => {
    let answer: (value: GatewayResult<LoginResponse>) => void = () => {}
    const { a, b } = twoTabs({}, { refreshSession: () => new Promise((resolve) => (answer = resolve)) })
    start(a.session)
    const restoring = b.session.restore()
    expect(b.session.getSnapshot()).toEqual({ status: 'restoring' })

    await a.session.signOut()
    answer(loginOk(adminProfile, 'late'))
    await restoring
    expect(b.session.getAccessToken()).toBeNull()
    expect(b.session.getSnapshot()).toEqual({ status: 'anonymous', arrivalReason: 'signedOut', email: null })
  })

  it('a token renewal and a restoration are not announced', async () => {
    const bus = new Bus()
    const a = tab({ refreshSession: async () => loginOk(adminProfile, 'restored') })
    const spy = vi.fn()
    a.session.subscribeSignals(spy)
    connectSessionSignals(a.session, createSessionSignals(channelWindow(bus)))
    await a.session.restore()
    expect(a.session.getAccessToken()).toBe('restored')
    expect(await a.session.renew('restored', 'sessionExpired')).toEqual({ kind: 'renewed' })
    expect(spy).not.toHaveBeenCalled()
  })
})
