import { createContext, useContext, useSyncExternalStore } from 'react'
import type { UserProfile } from './contract'
import type { SignInArrivalReason } from './signInOutcome'

/**
 * In-memory session (ADR-007, 09 §4.2): the access token lives only in this
 * closure. Nothing is written to localStorage, sessionStorage, cookies or
 * IndexedDB, so reloading the page requires signing in again.
 *
 * The React snapshot deliberately excludes the token; only the future HTTP
 * adapter reads it through `getAccessToken()`.
 */
export type SessionSnapshot =
  | {
      readonly status: 'anonymous'
      readonly arrivalReason: SignInArrivalReason | null
      /** Email of the session that just ended, kept in memory to prefill the form (states.md §3). */
      readonly email: string | null
    }
  | { readonly status: 'authenticated'; readonly profile: UserProfile; readonly expiresAt: string }

export interface SessionStore {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  getAccessToken(): string | null
  /** Accepts administrator sessions only; any other role is refused before anything is kept. */
  start(session: { accessToken: string; expiresAt: string; profile: UserProfile }): void
  /** Local sign-out: drops the token (arrival `signedOut`). The server has no revocation route in P0 (09 §4.2). */
  signOut(): void
  /**
   * A protected request returned 401: drop the token and remember why, and which
   * email to prefill, for the sign-in page. `email` defaults to the ended profile's.
   */
  end(reason: Exclude<SignInArrivalReason, 'signedOut'>, email?: string): void
  /** Clears the arrival reason once the sign-in page has shown it. */
  acknowledgeArrival(): void
}

const ANONYMOUS: SessionSnapshot = { status: 'anonymous', arrivalReason: null, email: null }

export function createSessionStore(): SessionStore {
  let accessToken: string | null = null
  let snapshot: SessionSnapshot = ANONYMOUS
  const listeners = new Set<() => void>()

  function set(next: SessionSnapshot, token: string | null) {
    accessToken = token
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getAccessToken: () => accessToken,
    start({ accessToken: token, expiresAt, profile }) {
      if (profile.role !== 'ADMIN') throw new Error('Aegis Manager sessions are limited to administrators')
      set({ status: 'authenticated', profile, expiresAt }, token)
    },
    signOut() {
      set({ status: 'anonymous', arrivalReason: 'signedOut', email: null }, null)
    },
    end(reason, email) {
      const endedEmail = email ?? (snapshot.status === 'authenticated' ? snapshot.profile.email : null)
      set({ status: 'anonymous', arrivalReason: reason, email: endedEmail }, null)
    },
    acknowledgeArrival() {
      if (snapshot.status === 'anonymous' && snapshot.arrivalReason !== null) set(ANONYMOUS, null)
    },
  }
}

export const SessionContext = createContext<SessionStore | null>(null)

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext)
  if (!store) throw new Error('useSessionStore requires a SessionContext provider')
  return store
}

export function useSession(): SessionSnapshot {
  const store = useSessionStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
