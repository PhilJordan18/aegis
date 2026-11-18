import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { adminProfile } from '../features/auth/testFixtures'
import { createSessionStore } from '../features/auth/session'
import { clearCacheOnSessionChange } from './serverState'

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
})
