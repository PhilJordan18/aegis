import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api/serverState'
import { App } from '../app/App'
import { anomalyPageOf, fakeAnomalyGateway, ok as anomalyOk, OPERATION_ID as ANOMALY_OPERATION_ID, parsedAnomaly } from '../features/anomalies/testFixtures'
import { OPERATION_ID as AUDIT_OPERATION_ID, auditPage, eventView, fakeAuditGateway, pageOk } from '../features/audit/testFixtures'
import { unconfiguredAuthGateway, type AuthGateway } from '../features/auth/authGateway'
import { createSessionStore } from '../features/auth/session'
import { adminProfile, sessionStubs } from '../features/auth/testFixtures'
import { fakeCatalogGateway, MM001, MM002, ok as catalogOk, pageOf } from '../features/catalog/testFixtures'
import { A1, DEMO_LOCKER_ID, fakeLockerGateway, lockerStatus, ok as lockerOk } from '../features/lockers/testFixtures'
import type { Locale } from '../i18n/locale'
import { installMatchMedia } from '../test/matchMedia'
import { renderWithProviders } from '../test/renderApp'

configure({ asyncUtilTimeout: 4000 })

const authGateway: AuthGateway = { ...unconfiguredAuthGateway, ...sessionStubs, currentProfile: async () => ({ kind: 'ok', value: adminProfile, requestId: null }) }
const hrefOf = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole('link', { name }).getAttribute('href')

function mount(url: string, options: Parameters<typeof renderWithProviders>[1] & { locale?: Locale }) {
  const session = createSessionStore()
  session.start({ accessToken: 'token-value', expiresAt: '2026-09-30T15:30:00Z', expiresIn: 3600, profile: adminProfile })
  window.history.replaceState(null, '', url)
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  return renderWithProviders(<App />, { gateway: authGateway, session, queryClient, ...options })
}

beforeEach(() => installMatchMedia(window, false))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('R2: anomaly dossier', () => {
  const withOperation = parsedAnomaly()
  const gateway = (view = withOperation) =>
    fakeAnomalyGateway({ listAnomalies: async () => anomalyOk(anomalyPageOf([view])), getAnomaly: async () => anomalyOk({ ...view, evidence: { items: [], unreadable: 0 } }) })

  it('links the anomaly to its operation and to the audit of that operation', async () => {
    mount('/anomalies', { anomalyGateway: gateway() })
    const dossier = await waitFor(() => {
      const found = document.querySelector('.ag-dossier__scroll') as HTMLElement | null
      if (found === null) throw new Error('no dossier')
      return found
    })
    await within(dossier).findByRole('link', { name: "Ouvrir l'opération" })
    expect(hrefOf(dossier, "Ouvrir l'opération")).toBe(`/reservations-prets?vue=operations&dossier=${ANOMALY_OPERATION_ID}`)
    expect(hrefOf(dossier, 'Audit de cette opération')).toBe(`/audit?operation=${ANOMALY_OPERATION_ID}`)
  })

  it('offers neither link when the anomaly names no operation', async () => {
    mount('/anomalies', { anomalyGateway: gateway(parsedAnomaly({ lockerOperationId: null })) })
    expect(await screen.findByText('Aucune opération liée')).toBeDefined()
    expect(screen.queryByRole('link', { name: "Ouvrir l'opération" })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Audit de cette opération' })).toBeNull()
  })

  it('has the same links in English', async () => {
    mount('/anomalies', { anomalyGateway: gateway(), locale: 'en' })
    expect(await screen.findByRole('link', { name: 'Open the operation' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Audit of this operation' })).toBeDefined()
  })
})

describe('R2: audit dossier', () => {
  const event = eventView(1, { eventType: 'COMMAND_ACKNOWLEDGED', subjectType: 'LOCKER_OPERATION', operationId: AUDIT_OPERATION_ID })

  it('links an event to the dossier of its operation, beside the audit filter on it', async () => {
    mount('/audit', { auditGateway: fakeAuditGateway([pageOk(auditPage([event]))]) })
    const link = await screen.findByRole('link', { name: "Ouvrir le dossier de l'opération" })
    expect(link.getAttribute('href')).toBe(`/reservations-prets?vue=operations&dossier=${AUDIT_OPERATION_ID}`)
    expect(screen.getByRole('link', { name: 'Filtrer sur cette opération' }).getAttribute('href')).toBe(`/audit?operation=${AUDIT_OPERATION_ID}`)
  })

  it('offers no operation link on an event without operation', async () => {
    mount('/audit', { auditGateway: fakeAuditGateway([pageOk(auditPage([eventView(2, { operationId: null })]))]) })
    expect(await screen.findByText('Aucune opération associée')).toBeDefined()
    expect(screen.queryByRole('link', { name: "Ouvrir le dossier de l'opération" })).toBeNull()
  })

  it('has the same link in English', async () => {
    mount('/audit', { auditGateway: fakeAuditGateway([pageOk(auditPage([event]))]), locale: 'en' })
    expect(await screen.findByRole('link', { name: 'Open the operation file' })).toBeDefined()
  })
})

describe('R3: Casiers and Équipements entries', () => {
  const placed = { ...MM001, placement: { lockerId: DEMO_LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1.id, compartmentCode: 'A1' } }

  it('links a locker to the operations filtered on it', async () => {
    mount('/casiers', {
      catalogGateway: fakeCatalogGateway({ pages: [catalogOk(pageOf([placed, MM002]))] }),
      lockerGateway: fakeLockerGateway({ [DEMO_LOCKER_ID]: [lockerOk(lockerStatus())] }),
    })
    const link = await screen.findByRole('link', { name: 'Voir les opérations de ce casier' })
    expect(link.getAttribute('href')).toBe(`/reservations-prets?vue=operations&casier=${DEMO_LOCKER_ID}`)
  })

  it('links an equipment to its loans, reservations, operations and audit', async () => {
    mount('/equipements', { catalogGateway: fakeCatalogGateway({ pages: [catalogOk(pageOf([MM001, MM002]))], units: { [MM001.id]: catalogOk(MM001) } }) })
    const section = (await screen.findByRole('heading', { level: 3, name: 'Historique de cet équipement' })).closest('section') as HTMLElement
    expect(hrefOf(section, 'Voir les prêts de cet équipement')).toBe(`/reservations-prets?vue=prets&equipement=${MM001.id}`)
    expect(hrefOf(section, 'Voir les réservations de cet équipement')).toBe(`/reservations-prets?equipement=${MM001.id}`)
    expect(hrefOf(section, 'Voir les opérations de cet équipement')).toBe(`/reservations-prets?vue=operations&equipement=${MM001.id}`)
    expect(hrefOf(section, "Voir l’audit de cet équipement")).toBe(`/audit?sujetType=ASSET&sujet=${MM001.id}`)
    expect(section.textContent).toContain('Les événements d’une opération se lisent depuis cette opération.')
  })

  it('has the same links in English', async () => {
    mount('/equipements', { catalogGateway: fakeCatalogGateway({ pages: [catalogOk(pageOf([MM001]))], units: { [MM001.id]: catalogOk(MM001) } }), locale: 'en' })
    const section = (await screen.findByRole('heading', { level: 3, name: 'History of this equipment' })).closest('section') as HTMLElement
    expect(within(section).getAllByRole('link')).toHaveLength(4)
  })
})
