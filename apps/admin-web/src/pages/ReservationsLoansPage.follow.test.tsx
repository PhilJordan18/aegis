import { cleanup, configure, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { unconfiguredAuthGateway, type AuthGateway, type GatewayResult } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, problemBody } from '../features/auth/testFixtures'
import { asset, fakeCatalogGateway, ok as catalogOk } from '../features/catalog/testFixtures'
import { parseLockerOperationView } from '../features/transactions/contractParsers'
import type { LockerOperationView } from '../features/transactions/contract'
import type { TransactionGateway } from '../features/transactions/transactionGateway'
import { ASSET_ID, OPERATION_ID, lockerOperationView } from '../features/transactions/testFixtures'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

// Real timers: the page follows an operation about every second, so a change shows within a few seconds.
configure({ asyncUtilTimeout: 5000 })

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const ok = <T,>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-follow' })
const operation = (status: string): LockerOperationView => {
  const terminal = ['CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY'].includes(status)
  const parsed = parseLockerOperationView(lockerOperationView({ status, terminalAt: terminal ? '2026-11-10T14:05:00Z' : null, confirmedAt: status === 'CONFIRMED' ? '2026-11-10T14:05:00Z' : null, observationReceivedAt: null, doorOpenedAt: null }))
  if (parsed === null) throw new Error('bad fixture')
  return parsed
}

/** The server's current status of the operation, changed by a test the way the backend would. */
function followedGateway(statuses: { current: string }) {
  const gateway = {
    listLockerOperations: vi.fn(async () => ok({ items: [operation(statuses.current)], page: 0, size: 20, totalItems: 1, totalPages: 1 })),
    getLockerOperation: vi.fn(async () => ok(operation(statuses.current))),
    listReservations: vi.fn(),
    getReservation: vi.fn(),
    listLoans: vi.fn(),
    getLoan: vi.fn(),
  }
  return gateway as unknown as TransactionGateway & typeof gateway
}

function renderPage(gateway: TransactionGateway) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', `/reservations-prets?vue=operations&dossier=${OPERATION_ID}`)
  const catalogGateway = fakeCatalogGateway({ units: { [ASSET_ID]: catalogOk(asset({ id: ASSET_ID, assetCode: 'MM-001' })) } })
  return renderWithProviders(<App />, { gateway: authGateway, transactionGateway: gateway, catalogGateway, session, queryClient: createQueryClient() })
}

const dossier = () => (document.querySelector('.ag-dossier__scroll') as HTMLElement).textContent ?? ''
const liveRegions = () => [...document.querySelectorAll('[role="status"]')].map((region) => (region.textContent ?? '').replace(/\u00A0/g, ' '))

beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('the open operation dossier follows the server without a click (ADR-006, R5)', () => {
  it('moves from the acknowledged command to the confirmed operation, announces each change, and stops reading', async () => {
    const statuses = { current: 'COMMAND_ACKNOWLEDGED' }
    const gateway = followedGateway(statuses)
    renderPage(gateway)
    await waitFor(() => expect(dossier()).toContain('Commande acquittée'))
    expect(liveRegions().some((text) => text.includes('Opération mise à jour'))).toBe(false)

    statuses.current = 'DOOR_OPENED'
    await waitFor(() => expect(dossier()).toContain('Porte ouverte'))
    await waitFor(() => expect(liveRegions()).toContain('Opération mise à jour : Porte ouverte.'))

    statuses.current = 'CONFIRMED'
    await waitFor(() => expect(dossier()).toContain('Confirmée'))
    await waitFor(() => expect(liveRegions()).toContain('Opération mise à jour : Confirmée.'))

    // Terminal: the list is read once more (its row must not stay acknowledged), then nothing, however long it waits.
    await waitFor(() => expect(gateway.listLockerOperations.mock.calls.length).toBeGreaterThanOrEqual(2))
    const reads = gateway.getLockerOperation.mock.calls.length
    const lists = gateway.listLockerOperations.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(gateway.getLockerOperation.mock.calls.length).toBe(reads)
    expect(gateway.listLockerOperations.mock.calls.length).toBe(lists)
  })

  it('never follows the list while the operation is open: one list read in several seconds', async () => {
    const statuses = { current: 'COMMAND_ACKNOWLEDGED' }
    const gateway = followedGateway(statuses)
    renderPage(gateway)
    await waitFor(() => expect(dossier()).toContain('Commande acquittée'))
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(gateway.listLockerOperations).toHaveBeenCalledTimes(1)
    expect(gateway.getLockerOperation.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the page and shows the stale notice when a poll fails, then recovers without a click', async () => {
    const statuses = { current: 'COMMAND_ACKNOWLEDGED' }
    const gateway = followedGateway(statuses)
    renderPage(gateway)
    await waitFor(() => expect(dossier()).toContain('Commande acquittée'))
    gateway.getLockerOperation.mockImplementationOnce(async () => ({ kind: 'network', reason: 'offline' }) as never)
    await waitFor(() => expect(dossier()).toContain('Données non actualisées'))
    statuses.current = 'DOOR_OPENED'
    await waitFor(() => expect(dossier()).toContain('Porte ouverte'))
    await waitFor(() => expect(dossier()).not.toContain('Données non actualisées'))
  })

  it('lets the existing error handling apply on a 404 and reads no more', async () => {
    const statuses = { current: 'COMMAND_ACKNOWLEDGED' }
    const gateway = followedGateway(statuses)
    renderPage(gateway)
    await waitFor(() => expect(dossier()).toContain('Commande acquittée'))
    gateway.getLockerOperation.mockImplementation(async () => ({ kind: 'httpProblem', status: 404, problem: problemBody(404, 'RESOURCE_NOT_FOUND'), retryAfter: null, requestId: 'req-x' }) as never)
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    const reads = gateway.getLockerOperation.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(gateway.getLockerOperation.mock.calls.length).toBe(reads)
  })
})
