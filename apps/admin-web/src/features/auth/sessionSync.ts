import type { SessionSignal, SessionStore } from './session'

/**
 * Tab coordination (#178): one browser session, several tabs. A tab that confirmed a sign-out, or signed in through
 * the form, tells the others; they act on the signal alone and ask the server what is true. A signal is only its
 * name: never a token, an account or an address. The transport is a BroadcastChannel; where the browser has none,
 * a `storage` event carries the same name, written and removed at once so that nothing stays in storage.
 */
export interface SessionSignals {
  post(signal: SessionSignal): void
  subscribe(listener: (signal: SessionSignal) => void): () => void
  close(): void
}

export const SIGNAL_CHANNEL = 'aegis.manager.session'
/** The only key the fallback writes. Its value is `<signal>:<nonce>` for the instant of one `storage` event. */
export const SIGNAL_STORAGE_KEY = 'aegis.manager.session-signal'

const SIGNALS: readonly SessionSignal[] = ['signedOut', 'signedIn']

function isSignal(value: unknown): value is SessionSignal {
  return typeof value === 'string' && (SIGNALS as readonly string[]).includes(value)
}

/** The parts of `window` used here, so a test can hide the BroadcastChannel or the storage. */
export interface SignalWindow {
  readonly BroadcastChannel?: typeof BroadcastChannel
  readonly localStorage?: Storage
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
}

export function createSessionSignals(win: SignalWindow = window): SessionSignals {
  const listeners = new Set<(signal: SessionSignal) => void>()
  const deliver = (signal: unknown) => {
    if (isSignal(signal)) listeners.forEach((listener) => listener(signal))
  }

  let channel: BroadcastChannel | null = null
  try {
    if (typeof win.BroadcastChannel === 'function') {
      channel = new win.BroadcastChannel(SIGNAL_CHANNEL)
      channel.onmessage = (event: MessageEvent<unknown>) => deliver(event.data)
    }
  } catch {
    channel = null
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SIGNAL_STORAGE_KEY || event.newValue === null) return
    deliver(event.newValue.split(':')[0])
  }
  if (channel === null) win.addEventListener('storage', onStorage)

  return {
    post(signal) {
      if (channel !== null) {
        channel.postMessage(signal)
        return
      }
      try {
        const storage = win.localStorage
        if (!storage) return
        const nonce = Math.random().toString(36).slice(2)
        storage.setItem(SIGNAL_STORAGE_KEY, `${signal}:${nonce}`)
        storage.removeItem(SIGNAL_STORAGE_KEY)
      } catch {
        // Storage can be blocked: the other tabs then learn the truth on their next request, never from a guess.
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      listeners.clear()
      channel?.close()
      if (channel === null) win.removeEventListener('storage', onStorage)
    },
  }
}

/** Sends this tab's sign-in and confirmed sign-out to the others and applies theirs. Returns the disconnect function. */
export function connectSessionSignals(session: SessionStore, signals: SessionSignals): () => void {
  const stopSending = session.subscribeSignals((signal) => signals.post(signal))
  const stopReceiving = signals.subscribe((signal) => session.receive(signal))
  return () => {
    stopSending()
    stopReceiving()
    signals.close()
  }
}
