import { useRef } from 'react'
import { randomRequestId } from './http'

/**
 * One `Idempotency-Key` per intent (09 §6.2): the same body sent again (a retry after a timeout, a double
 * submit) reuses the key, so the server applies it once; a different body is a new intent and gets a new key,
 * never `IDEMPOTENCY_KEY_REUSED`. `reset` starts over, for a form opened again.
 */
export function useIdempotencyKey(): { readonly keyFor: (intent: unknown) => string; readonly reset: () => void } {
  const current = useRef<{ readonly intent: string; readonly key: string } | null>(null)
  return {
    keyFor(intent) {
      const serialized = JSON.stringify(intent) ?? ''
      if (current.current?.intent !== serialized) current.current = { intent: serialized, key: randomRequestId() }
      return current.current.key
    },
    reset() {
      current.current = null
    },
  }
}
