import type { GatewayResult } from '../features/auth/authGateway'
import { parseProblem } from './problem'

/**
 * Minimal JSON client for the Aegis Control API (09 §3, §6.1, §7). Requests go
 * to the page's own origin under /api/v1: the Vite dev and preview servers
 * proxy them to the API, so local development needs no CORS.
 */
export const API_BASE_PATH = '/api/v1'

/** states.md §2: a request still pending after 15 s is abandoned as unreachable. */
export const REQUEST_TIMEOUT_MS = 15_000

export interface HttpClientOptions {
  /** Origin prefix; empty for the page's own origin. */
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly createRequestId?: () => string
}

export interface JsonRequest<T> {
  readonly method: 'GET' | 'POST'
  /** Path below /api/v1, starting with a slash. */
  readonly path: string
  readonly body?: unknown
  /** Sent as `Authorization: Bearer` (09 §4.3). Never logged. */
  readonly accessToken?: string
  readonly signal?: AbortSignal
  /** Validates a 2xx body against the contract; null when it does not match. */
  readonly parse: (body: unknown) => T | null
}

export interface HttpClient {
  send<T>(request: JsonRequest<T>): Promise<GatewayResult<T>>
}

/** RFC 9562 version 4 UUID. `crypto.randomUUID` exists only in secure contexts. */
export function randomRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const NO_BODY = Symbol('no JSON body')

/** Reads a JSON or problem+json body; any other type, or invalid JSON, is NO_BODY. Read errors propagate. */
async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('Content-Type') ?? ''
  if (!/\bjson\b/i.test(type)) return NO_BODY
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return NO_BODY
  }
}

export function createHttpClient({
  baseUrl = '',
  fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
  timeoutMs = REQUEST_TIMEOUT_MS,
  createRequestId = randomRequestId,
}: HttpClientOptions = {}): HttpClient {
  return {
    async send<T>({ method, path, body, accessToken, signal, parse }: JsonRequest<T>): Promise<GatewayResult<T>> {
      if (signal?.aborted) return { kind: 'aborted' }
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const forwardAbort = () => controller.abort()
      signal?.addEventListener('abort', forwardAbort, { once: true })

      const headers: Record<string, string> = {
        Accept: 'application/json, application/problem+json',
        'X-Request-Id': createRequestId(),
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (accessToken !== undefined) headers.Authorization = `Bearer ${accessToken}`

      try {
        const response = await fetchImpl(`${baseUrl}${API_BASE_PATH}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          // The bearer token is the only credential: no cookie is sent or stored.
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        })
        const requestId = response.headers.get('X-Request-Id')
        const payload = await readJson(response)
        if (response.ok) {
          const value = payload === NO_BODY ? null : parse(payload)
          return value === null ? { kind: 'invalidResponse', status: response.status, requestId } : { kind: 'ok', value, requestId }
        }
        return {
          kind: 'httpProblem',
          status: response.status,
          problem: payload === NO_BODY ? null : parseProblem(payload),
          retryAfter: response.headers.get('Retry-After'),
          requestId,
        }
      } catch {
        if (signal?.aborted) return { kind: 'aborted' }
        return { kind: 'network', reason: timedOut ? 'timeout' : 'offline' }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', forwardAbort)
      }
    },
  }
}
