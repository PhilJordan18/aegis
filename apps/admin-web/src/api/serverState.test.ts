import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminProfile } from '../features/auth/testFixtures'
import { createSessionStore } from '../features/auth/session'
import { clearCacheOnSessionChange, createQueryClient, READ_STALE_MS } from './serverState'

const start = (store: ReturnType<typeof createSessionStore>, accessToken: string, profile = adminProfile) =>
  store.start({ accessToken, expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile })

describe('clearCacheOnSessionChange', () => {
  function setup() {
    const client = new QueryClient()
    const session = createSessionStore()
    clearCacheOnSessionChange(client, session)
    return { client, session }
  }

  it('keeps the cache when the same account gets a renewed token (ADR-016)', () => {
    const { client, session } = setup()
    start(session, 'first')
    client.setQueryData(['assets'], ['MM-001'])
    start(session, 'renewed')
    expect(client.getQueryData(['assets'])).toEqual(['MM-001'])
  })

  it('clears it when the session ends, so the next account never sees it', () => {
    const { client, session } = setup()
    start(session, 'first')
    client.setQueryData(['assets'], ['MM-001'])
    session.end('sessionExpired')
    expect(client.getQueryData(['assets'])).toBeUndefined()
  })

  it('clears it when another account takes over without an end in between', () => {
    const { client, session } = setup()
    start(session, 'first')
    client.setQueryData(['assets'], ['MM-001'])
    start(session, 'second', { ...adminProfile, id: '00000000-0000-4000-8000-000000000002' })
    expect(client.getQueryData(['assets'])).toBeUndefined()
  })

  it('a read of the previous account that finishes after the switch never reaches the next account cache', async () => {
    const { client, session } = setup()
    start(session, 'first')
    let finish: (value: string[]) => void = () => {}
    const pending = client.fetchQuery({ queryKey: ['assets'], queryFn: () => new Promise<string[]>((resolve) => (finish = resolve)) }).catch(() => undefined)
    session.end('sessionExpired')
    start(session, 'second', { ...adminProfile, id: '00000000-0000-4000-8000-000000000002' })
    finish(['MM-001 du premier compte'])
    await pending
    expect(client.getQueryData(['assets'])).toBeUndefined()
  })
})

describe('the freshness of a read (#197)', () => {
  afterEach(() => vi.useRealTimers())

  it('trusts a read for a few seconds, not the 30 s that let a reserved unit be read as available', () => {
    expect(READ_STALE_MS).toBeLessThanOrEqual(5_000)
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBe(READ_STALE_MS)
  })

  it('reads again when a screen is entered after that, and shares the read with a screen entered at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const client = createQueryClient()
    const queryFn = vi.fn(async () => 'AVAILABLE')
    const read = () => client.fetchQuery({ queryKey: ['catalog', 'assets', 'list'], queryFn })
    await read()
    await read()
    expect(queryFn).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + READ_STALE_MS + 1)
    await read()
    expect(queryFn).toHaveBeenCalledTimes(2)
  })
})
