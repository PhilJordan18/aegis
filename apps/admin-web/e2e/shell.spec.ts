import { expect, test, type Page, type Route } from '@playwright/test'
import { openLockers, waitForLockerState } from './lockerFakes.ts'
import { expectNoAxeViolations } from './support.ts'

/**
 * Issue #249: a Manager page taller than the viewport never scrolls the document past the application frame. From
 * 1024 px the frame holds the viewport, the sidebar keeps its full height, and the main column is the scroll container.
 * Visually hidden elements stay inside their scroll container instead of lengthening the document.
 */
const TRACE_ID = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30'
const LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
const A1_ID = '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a1a01'
const ASSET_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const USER_ID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const ROWS = 30
const id = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`

const asset = {
  id: ASSET_ID,
  assetCode: 'MM-001',
  model: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Multimètre numérique', manufacturer: 'Fluke', modelNumber: '117' },
  placement: { lockerId: LOCKER_ID, lockerCode: 'AEGIS-DEMO-01', compartmentId: A1_ID, compartmentCode: 'A1' },
}
const reservation = (index: number) => ({
  id: id('33333333', index),
  asset,
  userId: USER_ID,
  user: { id: USER_ID, displayName: 'Technicien Démo' },
  status: 'ACTIVE',
  reservedFrom: '2026-11-10T14:00:00Z',
  reservedUntil: '2026-11-10T21:30:00Z',
  createdAt: '2026-11-10T14:00:00Z',
  cancelledAt: null,
  fulfilledAt: null,
  expiredAt: null,
  currentOperationId: null,
  availableActions: [],
})
const event = (index: number) => ({
  id: id('eeeeeeee', index),
  eventType: 'COMMAND_ACKNOWLEDGED',
  actor: null,
  subjectType: 'LOCKER_OPERATION',
  subjectId: id('44444444', index),
  operationId: id('44444444', index),
  fromState: 'COMMAND_SENT',
  toState: 'COMMAND_ACKNOWLEDGED',
  result: 'ACCEPTED',
  reason: null,
  occurredAt: '2026-11-10T14:01:32Z',
  details: {},
})
const anomaly = (index: number) => ({
  id: id('aaaaaaaa', index),
  type: 'EXPECTED_ASSET_NOT_OBSERVED',
  severity: 'HIGH',
  status: 'OPEN',
  lockerOperationId: null,
  assetId: ASSET_ID,
  compartmentId: A1_ID,
  detectedAt: '2026-11-10T19:01:00Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgementNote: null,
  resolvedAt: null,
  resolutionEvidenceObservationId: null,
  resolutionNote: null,
  summary: 'Équipement attendu non lu.',
  evidence: { items: [], unreadable: 0 },
})
const pageOf = (items: unknown[], size: number) => ({ items, page: 0, size, totalItems: items.length, totalPages: 1 })
const many = <T>(make: (index: number) => T) => Array.from({ length: ROWS }, (_, index) => make(index + 1))

async function routeLists(page: Page) {
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': TRACE_ID }, body: JSON.stringify(body) })
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace('/api/v1', '')
    const size = Number(url.searchParams.get('size') ?? 20)
    if (p === '/admin/reservations') return json(route, pageOf(many(reservation).slice(0, size), size))
    if (p === '/admin/audit-events') return json(route, { items: many(event).slice(0, size), nextCursor: null, hasMore: false })
    if (p === '/admin/anomalies') return json(route, pageOf(many(anomaly).slice(0, size), size))
    if (p === '/admin/loans' || p === '/admin/locker-operations' || p === '/admin/lockers' || p === '/admin/assets') return json(route, pageOf([], size))
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://aegis.local/problems/resource_not_found', title: 'Fictif', status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'Fictif', instance: url.pathname, traceId: TRACE_ID, timestamp: '2026-11-10T14:00:00Z' }) })
  })
}

const go = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url)

async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const main = document.querySelector<HTMLElement>('.ag-shell__main')!
    const content = document.querySelector<HTMLElement>('.ag-shell__content')!
    // Every scroll or clip container inside the frame: its scroll height is its content, not an escaped hidden element.
    const blankTails: string[] = []
    const crushed: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.ag-shell *')) {
      const style = getComputedStyle(el)
      if (style.overflowY === 'visible' || el.clientHeight <= 2) continue
      const bottoms = [...el.children].map((child) => {
        const r = child.getBoundingClientRect()
        return r.height === 0 ? 0 : r.bottom - el.getBoundingClientRect().top + el.scrollTop
      })
      const tail = el.scrollHeight - Math.max(el.clientHeight, ...bottoms) - parseFloat(style.paddingBottom)
      if (tail > 1) blankTails.push(`${el.className}: ${Math.round(tail)} px`)
      // A short window scrolls the main column; it never squeezes a page's own scrolling region to a sliver.
      if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight < 120) crushed.push(`${el.className}: ${el.clientHeight} px`)
    }
    return {
      innerHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      shell: box('.ag-shell'),
      side: box('.ag-side'),
      account: box('.ag-account__button'),
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      contentHeight: content.getBoundingClientRect().height,
      blankTails,
      crushed,
    }
  })
}

async function expectFrameHolds(page: Page, label: string) {
  const state = await measure(page)
  expect(Math.abs(state.shell.bottom - state.documentHeight), `${label}: the shell ends with the document`).toBeLessThanOrEqual(1)
  expect(state.documentHeight, `${label}: no page past the viewport`).toBe(state.innerHeight)
  expect(Math.abs(state.side.bottom - state.shell.bottom), `${label}: the sidebar covers the frame`).toBeLessThanOrEqual(1)
  expect(state.account.bottom, `${label}: the account button is visible`).toBeLessThanOrEqual(state.innerHeight)
  expect(Math.abs(state.mainScrollHeight - Math.max(state.mainClientHeight, state.contentHeight)), `${label}: the main column scrolls its content only`).toBeLessThanOrEqual(1)
  expect(state.blankTails, `${label}: no blank tail in a scroll container`).toEqual([])
  expect(state.crushed, `${label}: no scrolling region squeezed below 120 px`).toEqual([])
  return state
}

const WIDE = [
  [1280, 500],
  [1024, 560],
  [1024, 600],
  [1280, 640],
  [1440, 700],
  [1920, 1080],
] as const

test.describe('Manager shell scroll (#249)', () => {
  for (const [width, height] of WIDE) {
    test(`every Manager page holds the frame at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto('/connexion')
      await openLockers(page, 'offlineErrors')
      await waitForLockerState(page, 'offlineErrors')
      await expectFrameHolds(page, 'casiers')

      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await routeLists(page)
      for (const [label, url, ready] of [
        ['réservations', '/reservations-prets', '.ag-list .ag-list__items a'],
        ['audit', '/audit', '.ag-list .ag-list__items a'],
        ['anomalies', '/anomalies', '.ag-list .ag-list__items a'],
        ['vue d’ensemble', '/vue-d-ensemble', '.ag-page__title'],
        ['équipements', '/apercu/equipements', '.ag-page__title'],
      ] as const) {
        await go(page, url)
        await page.locator(ready).first().waitFor()
        await expect(page.locator('.ag-skel__bar')).toHaveCount(0)
        const state = await expectFrameHolds(page, label)
        // The first row of a list is shown whole, and every pager can be brought fully into view (0.99: sub-pixel rounding).
        const firstRow = page.locator('.ag-list__items a').first()
        if (await firstRow.count()) {
          await firstRow.evaluate((row) => row.scrollIntoView({ block: 'nearest' }))
          await expect(firstRow, `${label}: a whole row is visible`).toBeInViewport({ ratio: 0.99 })
        }
        for (const pager of await page.locator('.ag-pager').all()) {
          await pager.evaluate((nav) => nav.scrollIntoView({ block: 'nearest' }))
          await expect(pager, `${label}: the pager is reachable`).toBeInViewport({ ratio: 0.99 })
        }
        if (height <= 600) await expectNoAxeViolations(page)
        if (label === 'réservations' || label === 'audit') {
          // The end of a long list is reachable inside the frame, and reaching it never scrolls the document.
          const last = page.locator('.ag-list .ag-list__items a').last()
          await last.evaluate((row) => row.scrollIntoView({ block: 'end' }))
          await expect(last).toBeInViewport()
          const after = await measure(page)
          expect(after.documentHeight).toBe(state.innerHeight)
          expect(await page.evaluate(() => window.scrollY)).toBe(0)
        }
      }
    })
  }

  test('below 1024 px the document scrolls and ends with the shell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/connexion')
    await openLockers(page, 'offlineErrors')
    await waitForLockerState(page, 'offlineErrors')
    const state = await page.evaluate(() => ({
      innerHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      shellBottom: document.querySelector('.ag-shell')!.getBoundingClientRect().bottom + window.scrollY,
      mainScrolls: document.querySelector<HTMLElement>('.ag-shell__main')!.scrollHeight > document.querySelector<HTMLElement>('.ag-shell__main')!.clientHeight,
    }))
    expect(Math.abs(state.shellBottom - state.documentHeight)).toBeLessThanOrEqual(1)
    expect(state.documentHeight).toBeGreaterThan(state.innerHeight)
    expect(state.mainScrolls).toBe(false)
  })
})
