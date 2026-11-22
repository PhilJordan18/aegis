import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AuthGateway, GatewayFailure } from './authGateway'
import type { UserProfile } from './contract'
import type { SignInArrivalReason } from './signInOutcome'

/**
 * In-memory session (ADR-007, ADR-016, 09 §4.2): the access token lives only in this
 * closure. Nothing is written to localStorage, sessionStorage, cookies or IndexedDB.
 * Surviving a reload is the server's job: the login response sets an HttpOnly cookie
 * the script can never read, and `restore()` trades it for a fresh access token
 * through POST /auth/session/refresh.
 *
 * The React snapshot deliberately excludes the token; only authorized
 * requests read it through `getAccessToken()`.
 *
 * Expiry (09 §4.1: 60 minutes, or the absolute end of the browser session if
 * earlier): once `expiresIn` has elapsed since the response was received the
 * store makes exactly one refresh. A 401 from it ends the session with
 * `sessionExpired`. Counting from receipt rather than comparing `expiresAt`
 * with the browser clock keeps a skewed clock from extending or cutting the
 * session. The server stays authoritative: the client never decides by itself
 * that a session is valid, it only keeps what the server last granted.
 *
 * Refreshes are single-flight: a restore, an expiry and any number of
 * concurrent 401s share one request. A refresh that was overtaken by a
 * sign-in, a sign-out or an end (`epoch`) is discarded.
 */
export type SessionSnapshot =
  | {
      readonly status: 'anonymous'
      readonly arrivalReason: SignInArrivalReason | null
      /** Email of the session that just ended, kept in memory to prefill the form (states.md §3). */
      readonly email: string | null
    }
  /** Boot: the refresh route has not answered yet. Protected pages wait; nothing redirects. */
  | { readonly status: 'restoring' }
  /**
   * The refresh could not be answered (network, 5xx, 403, malformed body). The session is neither
   * granted nor refused: the Manager says so and offers a retry, instead of acting signed out.
   */
  | { readonly status: 'restoreFailed'; readonly failure: RestoreFailure; readonly traceId: string | null }
  | {
      readonly status: 'authenticated'
      readonly profile: UserProfile
      readonly expiresAt: string
      /** Explicit sign-out: `failed` keeps the session open because the server did not confirm the revocation. */
      readonly signOut: 'idle' | 'pending' | 'failed'
    }

/** `forbidden`: the server refused the restoration itself (403, e.g. an origin it does not allow). It is not a sign-out. */
export type RestoreFailure = 'unreachable' | 'serviceError' | 'forbidden'

/**
 * What one tab tells the others (sessionSync.ts). Signals never carry a token or an identity: a receiving tab
 * asks the server what is true. `signedOut` is sent only once the server confirmed the revocation.
 */
export type SessionSignal = 'signedOut' | 'signedIn'

/** What `renew` made of a protected 401. */
export type RenewOutcome =
  | { readonly kind: 'renewed' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'failed'; readonly failure: GatewayFailure }

/** The two browser-session calls the store needs; the full `AuthGateway` satisfies it. */
export type SessionTransport = Pick<AuthGateway, 'refreshSession' | 'revokeSession'>

export interface SessionStore {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  getAccessToken(): string | null
  /** Binds the transport used to restore, refresh and revoke. Until then every call fails as unreachable. */
  connect(transport: SessionTransport): void
  /**
   * A sign-in through the form. Accepts administrator sessions only; any other role is refused before anything is
   * kept. `expiresIn` is the token lifetime in seconds from the login response. Other tabs are told (`signedIn`).
   */
  start(session: { accessToken: string; expiresAt: string; expiresIn: number; profile: UserProfile }): void
  /** Local events other tabs must hear about: a confirmed sign-out and a sign-in through the form. */
  subscribeSignals(listener: (signal: SessionSignal) => void): () => void
  /**
   * What another tab announced. `signedOut` drops this tab's token and shows the signed-out arrival;
   * `signedIn` makes an open session ask the server again, so that a tab never keeps showing the data of an account
   * that is no longer the one the browser session belongs to. Anonymous tabs ignore `signedIn`.
   */
  receive(signal: SessionSignal): void
  /**
   * Boot restoration (ADR-016): asks the server for a session from the browser cookie. `restoring`
   * while pending; 401 leaves the visitor anonymous without an arrival notice; any other failure is
   * `restoreFailed`. Also the retry of a failed restoration. Never runs over an open session.
   */
  restore(): Promise<void>
  /**
   * A protected request got a 401 with `failedToken`: shares one refresh with every other caller.
   * `renewed` means the caller may retry once with the new token; `ended` that the session is over
   * (the store recorded why); `failed` that the server could not be asked.
   */
  renew(failedToken: string, reason: Exclude<SignInArrivalReason, 'signedOut'>): Promise<RenewOutcome>
  /**
   * Explicit sign-out: revokes the session on the server first, and drops the token only once the server
   * confirmed (arrival `signedOut`). Otherwise the session stays open with `signOut: 'failed'`, because a
   * reload would restore it. Resolves true when signed out.
   */
  signOut(): Promise<boolean>
  /**
   * A protected request returned 401 and no renewal is possible: drop the token and remember why, and
   * which email to prefill, for the sign-in page. `email` defaults to the ended profile's.
   */
  end(reason: Exclude<SignInArrivalReason, 'signedOut'>, email?: string): void
  /** Clears the arrival reason once the sign-in page has shown it. */
  acknowledgeArrival(): void
}

const ANONYMOUS: SessionSnapshot = { status: 'anonymous', arrivalReason: null, email: null }

// setTimeout fires immediately above 2^31-1 ms; no valid token lives that long.
const MAX_TIMER_MS = 2 ** 31 - 1

type RefreshOutcome =
  | { readonly kind: 'renewed' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed'; readonly failure: GatewayFailure }
  | { readonly kind: 'superseded' }

const NOT_CONNECTED: SessionTransport = {
  refreshSession: async () => ({ kind: 'network', reason: 'notConfigured' }),
  revokeSession: async () => ({ kind: 'network', reason: 'notConfigured' }),
}

function restoreFailureOf(failure: GatewayFailure): { failure: RestoreFailure; traceId: string | null } {
  switch (failure.kind) {
    case 'network':
    case 'aborted':
      return { failure: 'unreachable', traceId: null }
    case 'invalidResponse':
      return { failure: 'serviceError', traceId: failure.requestId }
    case 'httpProblem':
      if (failure.status === 403) return { failure: 'forbidden', traceId: failure.problem?.traceId ?? failure.requestId }
      if (failure.status >= 500 && failure.problem === null) return { failure: 'unreachable', traceId: null }
      return { failure: 'serviceError', traceId: failure.problem?.traceId ?? failure.requestId }
  }
}

export function createSessionStore(): SessionStore {
  let accessToken: string | null = null
  let snapshot: SessionSnapshot = ANONYMOUS
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  let transport: SessionTransport = NOT_CONNECTED
  let refreshInFlight: Promise<RefreshOutcome> | null = null
  // Bumped by every state change: a refresh that started before one must not apply its answer.
  let epoch = 0
  const listeners = new Set<() => void>()
  const signalListeners = new Set<(signal: SessionSignal) => void>()
  const emit = (signal: SessionSignal) => signalListeners.forEach((listener) => listener(signal))

  function publish(next: SessionSnapshot, token: string | null) {
    accessToken = token
    snapshot = next
    epoch += 1
    listeners.forEach((listener) => listener())
  }

  function set(next: SessionSnapshot, token: string | null) {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer)
      expiryTimer = null
    }
    publish(next, token)
  }

  function end(reason: Exclude<SignInArrivalReason, 'signedOut'>, email?: string) {
    const endedEmail = email ?? (snapshot.status === 'authenticated' ? snapshot.profile.email : null)
    set({ status: 'anonymous', arrivalReason: reason, email: endedEmail }, null)
  }

  function begin({ accessToken: token, expiresAt, expiresIn, profile }: Parameters<SessionStore['start']>[0]) {
    if (profile.role !== 'ADMIN') throw new Error('Aegis Manager sessions are limited to administrators')
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('A session needs a positive token lifetime')
    const signOut = snapshot.status === 'authenticated' ? snapshot.signOut : 'idle'
    set({ status: 'authenticated', profile, expiresAt, signOut }, token)
    expiryTimer = setTimeout(() => void onExpiry(), Math.min(expiresIn * 1000, MAX_TIMER_MS))
  }

  /** One refresh at a time, whoever asks. The answer is applied here, so every caller sees one outcome. */
  function refreshOnce(): Promise<RefreshOutcome> {
    if (refreshInFlight !== null) return refreshInFlight
    const startedAt = epoch
    const run = (async (): Promise<RefreshOutcome> => {
      const result = await transport.refreshSession()
      if (epoch !== startedAt) return { kind: 'superseded' }
      if (result.kind === 'ok') {
        const { user, accessToken: token, expiresAt, expiresIn } = result.value
        if (user.role === 'ADMIN') {
          begin({ accessToken: token, expiresAt, expiresIn, profile: user })
          return { kind: 'renewed' }
        }
        // Not an administrator: the Web never keeps this session, and the cookie would restore it again.
        void transport.revokeSession()
        return { kind: 'invalid' }
      }
      if (result.kind === 'httpProblem' && result.status === 401) return { kind: 'invalid' }
      return { kind: 'failed', failure: result }
    })().finally(() => {
      refreshInFlight = null
    })
    refreshInFlight = run
    return run
  }

  /**
   * The access token ran out: one refresh. A 401 ends the session as expired. When the server cannot be reached
   * (or refuses for another reason) the session and what the user sees are kept: the next protected request gets
   * a 401, asks again, and the page shows its own recoverable state with a retry.
   */
  async function onExpiry() {
    const outcome = await refreshOnce()
    if (outcome.kind === 'invalid') end('sessionExpired')
  }

  async function restoreFromServer() {
    if (snapshot.status !== 'restoring') set({ status: 'restoring' }, null)
    const outcome = await refreshOnce()
    if (outcome.kind === 'invalid') set(ANONYMOUS, null)
    else if (outcome.kind === 'failed') set({ status: 'restoreFailed', ...restoreFailureOf(outcome.failure) }, null)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getAccessToken: () => accessToken,
    connect(next) {
      transport = next
    },
    start(session) {
      begin(session)
      emit('signedIn')
    },
    subscribeSignals(listener) {
      signalListeners.add(listener)
      return () => signalListeners.delete(listener)
    },
    receive(signal) {
      if (signal === 'signedOut') {
        if (snapshot.status !== 'anonymous') set({ status: 'anonymous', arrivalReason: 'signedOut', email: null }, null)
      } else if (snapshot.status === 'authenticated' || snapshot.status === 'restoreFailed') {
        void restoreFromServer()
      }
    },
    restore() {
      if (snapshot.status === 'authenticated') return Promise.resolve()
      return restoreFromServer()
    },
    async renew(failedToken, reason) {
      // Another caller already replaced or ended this token: nothing left to ask the server.
      if (accessToken !== failedToken) return accessToken === null ? { kind: 'ended' } : { kind: 'renewed' }
      const outcome = await refreshOnce()
      switch (outcome.kind) {
        case 'renewed':
          return { kind: 'renewed' }
        case 'superseded':
          return accessToken !== null && accessToken !== failedToken ? { kind: 'renewed' } : { kind: 'ended' }
        case 'invalid':
          if (accessToken === failedToken) end(reason)
          return { kind: 'ended' }
        case 'failed':
          return { kind: 'failed', failure: outcome.failure }
      }
    },
    async signOut() {
      if (snapshot.status !== 'authenticated') {
        // No session to revoke (the design-review preview shows this arrival from an anonymous store).
        set({ status: 'anonymous', arrivalReason: 'signedOut', email: null }, null)
        return true
      }
      if (snapshot.signOut === 'pending') return false
      const { profile, expiresAt } = snapshot
      // The token and its timer stay: until the server confirms, this is still a live session.
      publish({ status: 'authenticated', profile, expiresAt, signOut: 'pending' }, accessToken)
      const result = await transport.revokeSession()
      if (result.kind === 'ok') {
        set({ status: 'anonymous', arrivalReason: 'signedOut', email: null }, null)
        // Only a confirmed revocation is announced: another tab must never be signed out by a failed attempt.
        emit('signedOut')
        return true
      }
      if (snapshot.status === 'authenticated') {
        publish({ ...snapshot, signOut: 'failed' }, accessToken)
      }
      return false
    },
    end,
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
