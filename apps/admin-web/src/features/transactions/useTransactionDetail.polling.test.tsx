import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { createQueryClient } from '../../api/serverState'
import { adminProfile, problemBody } from '../auth/testFixtures'
import type { GatewayResult } from '../auth/authGateway'
import { createSessionStore, SessionContext } from '../auth/session'
import { parseLockerOperationView, parseReservationView } from './contractParsers'
import type { LockerOperationView, ReservationView } from './contract'
import { TransactionGatewayContext } from './TransactionGatewayContext'
import type { TransactionGateway } from './transactionGateway'
import { ASSET_ID, LOAN_ID, OPERATION_ID, RESERVATION_ID, lockerOperationView, reservationView } from './testFixtures'
import { OPERATION_POLL_MAX_MS, operationPollDelay } from './operationPolling'
import { useTransactionDetail, useTransactionList, type TransactionRecord } from './useTransactionQueries'

const operation = (status: string, overrides: Record<string, unknown> = {}): LockerOperationView => {
  const terminal = ['CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY'].includes(status)
  const parsed = parseLockerOperationView(
    lockerOperationView({
      status,
      terminalAt: terminal ? '2026-11-10T14:05:00Z' : null,
      confirmedAt: status === 'CONFIRMED' ? '2026-11-10T14:05:00Z' : null,
      observationReceivedAt: null,
      doorOpenedAt: null,
      ...overrides,
    }),
  )
  if (parsed === null) throw new Error('bad fixture')
  return parsed
}
const reservation = (): ReservationView => {
  const parsed = parseReservationView(reservationView())
  if (parsed === null) throw new Error('bad fixture')
  return parsed
}

const ok = <T,>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-poll' })
const refusal = (status: number, code = 'RESOURCE_NOT_FOUND'): GatewayResult<never> => ({ kind: 'httpProblem', status, problem: problemBody(status, code), retryAfter: null, requestId: 'req-x' })
const offline: GatewayResult<never> = { kind: 'network', reason: 'offline' }

type Answer = GatewayResult<LockerOperationView> | Promise<GatewayResult<LockerOperationView>>

/** The gateway answers from a script: each read takes the next answer, the last one repeats. */
function scriptedGateway(script: Answer[]) {
  const times: number[] = []
  let index = 0
  const gateway = {
    getLockerOperation: vi.fn(async () => {
      times.push(Date.now())
      const answer = script[Math.min(index, script.length - 1)]
      index += 1
      return answer
    }),
    getReservation: vi.fn(async () => ok(reservation())),
    getLoan: vi.fn(),
    listLockerOperations: vi.fn(async () => ok({ items: [operation('COMMAND_ACKNOWLEDGED')], page: 0, size: 20, totalItems: 1, totalPages: 1 })),
    listReservations: vi.fn(),
    listLoans: vi.fn(),
  }
  return { gateway: gateway as unknown as TransactionGateway & typeof gateway, times }
}

function setup(gateway: TransactionGateway, client: QueryClient = createQueryClient()) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionContext value={session}>
        <TransactionGatewayContext value={gateway}>{children}</TransactionGatewayContext>
      </SessionContext>
    </QueryClientProvider>
  )
  return { client, wrapper }
}

let visibility: 'visible' | 'hidden' = 'visible'
function setVisibility(next: 'visible' | 'hidden') {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

// TanStack hands its notifications to React on a zero-delay timer, a failure one hop later: after the fake clock moves,
// two more milliseconds let the result and the effects settle.
/** Reads what the page reads: TanStack re-renders only for the properties a render touched. */
function renderDetail(wrapper: (props: { children: ReactNode }) => ReactNode, view: 'operations' | 'reservations' | 'loans' = 'operations', listed?: TransactionRecord) {
  return renderHook(
    () => {
      const query = useTransactionDetail(view, OPERATION_ID, listed)
      return { data: query.data, isRefetchError: query.isRefetchError, refetch: query.refetch }
    },
    { wrapper },
  )
}

const tick = async (ms: number) => {
  await act(() => vi.advanceTimersByTimeAsync(ms))
  await act(() => vi.advanceTimersByTimeAsync(2))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('operationPollDelay', () => {
  it('doubles after each consecutive failure up to a ceiling and starts again at one second', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(operationPollDelay)).toEqual([1_000, 2_000, 4_000, 8_000, OPERATION_POLL_MAX_MS, OPERATION_POLL_MAX_MS, OPERATION_POLL_MAX_MS])
  })
})

describe('the open operation dossier follows the server (ADR-006)', () => {
  it('reads about every second while the operation is not terminal and follows its statuses', async () => {
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED')), ok(operation('COMMAND_ACKNOWLEDGED')), ok(operation('DOOR_OPENED'))])
    const { wrapper } = setup(gateway)
    const { result } = renderDetail(wrapper)
    await tick(0)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(1)
    expect(result.current.data?.kind === 'operations' && result.current.data.item.status).toBe('COMMAND_ACKNOWLEDGED')

    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(3)
    expect(result.current.data?.kind === 'operations' && result.current.data.item.status).toBe('DOOR_OPENED')
    // 10 s of fake time: about one read per second, not a burst.
    await tick(7_000)
    expect(gateway.getLockerOperation.mock.calls.length).toBeGreaterThanOrEqual(10)
    expect(gateway.getLockerOperation.mock.calls.length).toBeLessThanOrEqual(11)
    expect(gateway.getLockerOperation.mock.calls[0]).toEqual(['token-value', OPERATION_ID, expect.any(AbortSignal)])
  })

  it('keeps one request in flight: a slow read is not doubled by the following ticks', async () => {
    let release: (value: GatewayResult<LockerOperationView>) => void = () => undefined
    const slow = new Promise<GatewayResult<LockerOperationView>>((resolve) => (release = resolve))
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED')), slow])
    const { wrapper } = setup(gateway)
    renderDetail(wrapper)
    await tick(0)
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    await tick(5_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    release(ok(operation('COMMAND_ACKNOWLEDGED')))
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(3)
  })

  it('backs off 2 s, 4 s, 8 s, then 15 s after consecutive failures, and returns to one second after a success', async () => {
    const { gateway, times } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED')), offline, offline, offline, offline, offline, offline, ok(operation('COMMAND_ACKNOWLEDGED'))])
    const { wrapper } = setup(gateway)
    renderDetail(wrapper)
    await tick(0)
    await tick(1_000 + 2_000 + 4_000 + 8_000 + 15_000 + 15_000 + 15_000)
    const gaps = times.slice(1).map((time, index) => time - (times[index] as number))
    // 1 s before the first failure, then the delay after each consecutive failure, then 1 s again after the success.
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000])
    await tick(1_000)
    expect(times.length).toBe(9)
    // The failed polls were not retried inside their own request: one read per attempt.
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(9)
  })

  it('stops at a terminal status, then reads the linked reservation, loan, equipment and operation lists once', async () => {
    const { gateway } = scriptedGateway([ok(operation('DOOR_OPENED')), ok(operation('CONFIRMED'))])
    const { wrapper, client } = setup(gateway)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderDetail(wrapper)
    await tick(0)
    expect(invalidate).not.toHaveBeenCalled()
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      queryKeys.catalog.asset(ASSET_ID),
      queryKeys.transactions.reservation(RESERVATION_ID),
      queryKeys.transactions.loan(LOAN_ID),
      queryKeys.transactions.operationLists,
    ])
    await tick(60_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledTimes(4)
  })

  it('does not refresh anything for an operation that was already terminal when opened', async () => {
    const { gateway } = scriptedGateway([ok(operation('FAILED'))])
    const { wrapper, client } = setup(gateway)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderDetail(wrapper)
    await tick(30_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(1)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('pauses while the tab is hidden and reads at once, even a fresh file, when it is visible again', async () => {
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED'))])
    const { wrapper } = setup(gateway)
    renderDetail(wrapper)
    await tick(0)
    await tick(2_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(3)

    act(() => setVisibility('hidden'))
    await tick(30_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(3)

    act(() => setVisibility('visible'))
    await tick(0)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(4)
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(5)
  })

  it('does not follow a reservation or a loan, nor any list', async () => {
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED'))])
    const { wrapper } = setup(gateway)
    const filters = { assetId: null, status: null, from: null, to: null, userId: null } as unknown as Parameters<typeof useTransactionList>[1]
    renderHook(
      () => {
        useTransactionDetail('reservations', RESERVATION_ID, undefined)
        return useTransactionList('operations', filters, 0)
      },
      { wrapper },
    )
    await tick(60_000)
    expect(gateway.getReservation).toHaveBeenCalledTimes(1)
    expect(gateway.listLockerOperations).toHaveBeenCalledTimes(1)
    expect(gateway.getLockerOperation).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'AUTH_TOKEN_INVALID'],
    [403, 'FORBIDDEN'],
    [404, 'RESOURCE_NOT_FOUND'],
  ])('stops for good on a %i, which the page then handles as it did before', async (status, code) => {
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED')), refusal(status, code)])
    const { wrapper } = setup(gateway)
    const { result } = renderDetail(wrapper)
    await tick(0)
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    expect(result.current.isRefetchError).toBe(true)
    await tick(120_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
  })

  it('keeps trying, with backoff, after a 503 or a 429', async () => {
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED')), refusal(503, 'SERVICE_UNAVAILABLE'), refusal(429, 'RATE_LIMITED'), ok(operation('DOOR_OPENED'))])
    const { wrapper } = setup(gateway)
    const { result } = renderDetail(wrapper)
    await tick(0)
    await tick(1_000 + 2_000 + 4_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(4)
    expect(result.current.isRefetchError).toBe(false)
    expect(result.current.data?.kind === 'operations' && result.current.data.item.status).toBe('DOOR_OPENED')
  })

  it('follows again after a manual refresh succeeds where a 404 had stopped it', async () => {
    const { gateway } = scriptedGateway([ok(operation('COMMAND_ACKNOWLEDGED')), refusal(404), ok(operation('DOOR_OPENED'))])
    const { wrapper } = setup(gateway)
    const { result } = renderDetail(wrapper)
    await tick(0)
    await tick(1_000)
    await tick(10_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(2)
    await act(async () => {
      await result.current.refetch()
    })
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(3)
    await tick(1_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(4)
  })

  it('does not follow a status this client does not know, nor start before the server has answered', async () => {
    const listed: TransactionRecord = { kind: 'operations', item: operation('COMMAND_ACKNOWLEDGED') }
    const { gateway } = scriptedGateway([ok(operation('SOMETHING_NEW'))])
    const { wrapper } = setup(gateway)
    renderDetail(wrapper, 'operations', listed)
    await tick(0)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(1)
    await tick(30_000)
    expect(gateway.getLockerOperation).toHaveBeenCalledTimes(1)
  })
})
