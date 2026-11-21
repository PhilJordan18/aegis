import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { waitForCatalogState } from './catalogFakes.ts'
import { E2E_EMAIL, E2E_PASSWORD, SESSION_COOKIE, routeFakeSessionApi, trackPaths, type FakeSessionApi } from './sessionFakes.ts'
import { expectNoAxeViolations, expectNoHorizontalScroll } from './support.ts'

/**
 * Browser session (ADR-016, #178): reload, direct link, revoked session, expiry and explicit sign-out, in a
 * real browser against route fakes (`npm run test:e2e:session`). The fake sets the real HttpOnly cookie, so
 * what the browser stores and sends is what is asserted; the page never reads it.
 */
const ORIGIN = 'http://127.0.0.1:5182'
const ACCOUNT = /Administrateur Essai/
const LIST = (page: Page) => page.getByRole('heading', { level: 2, name: /^(\d+) exemplaires$/ })

interface Harness {
  readonly api: FakeSessionApi
  /** Every path shown through the History API, across reloads. */
  readonly paths: string[]
}

async function harness(page: Page): Promise<Harness> {
  const api = await routeFakeSessionApi(page, ORIGIN)
  const paths = await trackPaths(page)
  return { api, paths }
}

async function signIn(page: Page) {
  await page.getByLabel('Adresse courriel').fill(E2E_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

/**
 * The page restores once per load, on every route, so the sign-in page of a first visit already made one
 * refresh. Assertions count what happened after the moment this is called.
 */
function refreshCounter(api: FakeSessionApi) {
  const baseline = api.calls.refresh
  return () => api.calls.refresh - baseline
}

async function openAccountMenu(page: Page) {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: ACCOUNT }).click()
}

/** Nothing about the session reaches a storage the page can read; the cookie is the server's, HttpOnly. */
async function expectNothingStored(page: Page) {
  const stored = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    cookie: document.cookie,
    databases: ((await indexedDB.databases?.()) ?? []).length,
  }))
  expect(stored).toEqual({ local: {}, session: {}, cookie: '', databases: 0 })
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)
}

test.describe('reload and direct link', () => {
  test('a reload keeps the session and the requested page, and nothing readable is stored', async ({ page, context }) => {
    const { api, paths } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await expect(page).toHaveURL(/\/equipements$/)
    await waitForCatalogState(page, 'nominal')

    expect(api.loginBodies).toEqual([{ email: E2E_EMAIL, password: E2E_PASSWORD, browserSession: true }])
    expect(await sessionCookie(context)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/v1/auth/session' })
    await expectNothingStored(page)

    const before = paths.length
    const refreshes = refreshCounter(api)
    await page.reload()
    await waitForCatalogState(page, 'nominal')
    await expect(page).toHaveURL(/\/equipements$/)
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: ACCOUNT })).toBeVisible()

    expect(refreshes()).toBe(1)
    expect(paths.slice(before).some((path) => path.startsWith('/connexion'))).toBe(false)
    await expectNothingStored(page)
    expect(api.cookieLeaks).toEqual([])
    expect(new Set(api.origins)).toEqual(new Set([ORIGIN]))
  })

  test('a direct link to a protected page, with its query, restores the session', async ({ page }) => {
    const { api, paths } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    const before = paths.length
    const refreshes = refreshCounter(api)
    await page.goto('/equipements?recherche=MM-002')
    await waitForCatalogState(page, 'nominal')
    await expect(page).toHaveURL(/\/equipements\?recherche=MM-002$/)
    await expect(page.getByRole('searchbox', { name: 'Rechercher un exemplaire' })).toHaveValue('MM-002')
    expect(refreshes()).toBe(1)
    expect(paths.slice(before).some((path) => path.startsWith('/connexion'))).toBe(false)
  })

  test('the restoring state is shown, without a redirect, until the refresh answers', async ({ page }) => {
    const { api, paths } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    const refreshes = refreshCounter(api)
    const before = paths.length
    const release = api.holdRefresh()
    await page.goto('/equipements?recherche=MM-002')
    await expect(page.getByRole('heading', { level: 1, name: 'Restauration de votre session' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Vérification de votre session en cours.')
    await expect(page).toHaveURL(/\/equipements\?recherche=MM-002$/)
    expect(paths.slice(before).some((path) => path.startsWith('/connexion'))).toBe(false)
    expect(refreshes()).toBe(1)

    release()
    await waitForCatalogState(page, 'nominal')
    await expect(page).toHaveURL(/\/equipements\?recherche=MM-002$/)
  })
})

test.describe('session ended by the server', () => {
  test('a revoked session asks to sign in once, without a loop, then returns to the requested page', async ({ page }) => {
    const { api, paths } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    api.revokeAllSessions()
    const refreshes = refreshCounter(api)
    const before = paths.length
    await page.goto('/equipements?recherche=MM-001')
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipements%3Frecherche%3DMM-001$/)
    await expect(page.getByLabel('Adresse courriel')).toBeVisible()
    // Once: the refresh refused, the page replaced itself with the sign-in page and stays there.
    await page.waitForTimeout(500)
    expect(refreshes()).toBe(1)
    expect(paths.slice(before).filter((path) => path.startsWith('/connexion'))).toHaveLength(1)
    // The refusal clears the cookie.
    expect(await sessionCookie(page.context())).toBeUndefined()

    await signIn(page)
    await expect(page).toHaveURL(/\/equipements\?recherche=MM-001$/)
    await waitForCatalogState(page, 'nominal')
    expect(refreshes()).toBe(1)
    expect(api.calls.login).toBe(2)
  })

  test('an unsafe return path is ignored: the sign-in lands on the default page of this origin', async ({ page }) => {
    const { api } = await harness(page)
    await page.goto('/connexion?retour=%2F%2Fevil.example%2Fcasiers')
    await expect(page.getByLabel('Adresse courriel')).toBeVisible()
    await signIn(page)
    await expect(page).toHaveURL(/\/equipements$/)
    expect(new URL(page.url()).origin).toBe(ORIGIN)
    expect(api.calls.login).toBe(1)
  })

  test('a 401 on a protected read renews the token once and retries, without leaving the page', async ({ page }) => {
    const { api, paths } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    api.expireAccessTokens()
    const refreshes = refreshCounter(api)
    const before = paths.length
    await page.getByRole('searchbox', { name: 'Rechercher un exemplaire' }).fill('MM-002')
    await page.keyboard.press('Enter')
    await expect.poll(() => refreshes()).toBe(1)
    await waitForCatalogState(page, 'nominal')
    expect(refreshes()).toBe(1)
    expect(paths.slice(before).some((path) => path.startsWith('/connexion'))).toBe(false)
  })

  test('at token expiry the page makes one refresh and carries on', async ({ page }) => {
    const { api } = await harness(page)
    api.tokenLifetime = 2
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')
    api.tokenLifetime = 3600
    const refreshes = refreshCounter(api)

    await expect.poll(() => refreshes(), { timeout: 10_000 }).toBe(1)
    await page.waitForTimeout(1500)
    expect(refreshes()).toBe(1)
    await expect(page).toHaveURL(/\/equipements$/)
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: ACCOUNT })).toBeVisible()
  })

  test('at token expiry with the session revoked, the page ends with the expired-session notice, once', async ({ page }) => {
    const { api } = await harness(page)
    api.tokenLifetime = 2
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    const refreshes = refreshCounter(api)
    api.revokeAllSessions()
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipements$/, { timeout: 10_000 })
    await expect(page.getByText('Votre session a expiré. Reconnectez-vous.')).toBeVisible()
    await page.waitForTimeout(500)
    expect(refreshes()).toBe(1)
  })

  test('a server that cannot be reached at boot is said, not mistaken for a sign-out, and a retry restores', async ({ page }) => {
    const { api, paths } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    const refreshes = refreshCounter(api)
    const before = paths.length
    api.refreshMode = 'unreachable'
    await page.goto('/equipements')
    const heading = page.getByRole('heading', { level: 1, name: 'Restauration de votre session' })
    await expect(page.getByRole('alert')).toContainText("Le service est injoignable. Votre session n'a pas pu être rétablie.")
    await expect(heading).toBeFocused()
    await expect(page).toHaveURL(/\/equipements$/)
    expect(paths.slice(before).some((path) => path.startsWith('/connexion'))).toBe(false)

    api.refreshMode = 'normal'
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await waitForCatalogState(page, 'nominal')
    expect(refreshes()).toBe(2)
  })
})

test.describe('explicit sign-out', () => {
  test('revokes on the server, stays effective after a reload, and the browser cookie is cleared', async ({ page, context }) => {
    const { api } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    await openAccountMenu(page)
    await page.getByRole('button', { name: 'Se déconnecter' }).first().click()
    await expect(page).toHaveURL(/\/connexion$/)
    await expect(page.getByRole('status').filter({ hasText: 'Vous êtes déconnecté.' })).toBeVisible()
    expect(api.calls.revoke).toBe(1)
    expect(await sessionCookie(context)).toBeUndefined()

    const refreshes = refreshCounter(api)
    await page.goto('/equipements')
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fequipements$/)
    await expect(page.getByLabel('Adresse courriel')).toBeVisible()
    expect(refreshes()).toBe(1)
    await expectNothingStored(page)
  })

  test('an unconfirmed revocation keeps the session and says so; the retry signs out', async ({ page }) => {
    const { api } = await harness(page)
    await page.goto('/connexion')
    await signIn(page)
    await waitForCatalogState(page, 'nominal')

    api.failRevocations(1)
    await openAccountMenu(page)
    await page.getByRole('button', { name: 'Se déconnecter' }).first().click()
    const alert = page.getByRole('alert').filter({ hasText: 'Déconnexion non confirmée.' })
    await expect(alert).toBeVisible()
    await expect(page).toHaveURL(/\/equipements$/)
    await expect(LIST(page)).toBeVisible()
    // A reload would restore the session: that is why the Manager stays signed in.
    expect(await sessionCookie(page.context())).toBeDefined()

    await alert.getByRole('button', { name: 'Réessayer la déconnexion' }).click()
    await expect(page).toHaveURL(/\/connexion$/)
    expect(api.calls.revoke).toBe(2)
    expect(await sessionCookie(page.context())).toBeUndefined()
  })
})

// Rendered accessibility of the two new states, in both themes, at desktop and narrow widths.
const THEMES = ['light', 'dark'] as const
const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'narrow', width: 390, height: 844 },
] as const

for (const theme of THEMES) {
  for (const size of SIZES) {
    test.describe(`axe ${theme} ${size.name}`, () => {
      test.use({ colorScheme: theme, viewport: { width: size.width, height: size.height } })

      test('restoring state', async ({ page }) => {
        const { api } = await harness(page)
        await page.goto('/connexion')
        await signIn(page)
        await waitForCatalogState(page, 'nominal')
        const release = api.holdRefresh()
        await page.goto('/equipements')
        await expect(page.getByRole('heading', { level: 1, name: 'Restauration de votre session' })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
        release()
      })

      test('restoration failed (unreachable and service error)', async ({ page }) => {
        const { api } = await harness(page)
        await page.goto('/connexion')
        await signIn(page)
        await waitForCatalogState(page, 'nominal')
        for (const mode of ['unreachable', 'serviceError'] as const) {
          api.refreshMode = mode
          await page.goto('/equipements')
          await expect(page.getByRole('alert')).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          await expectNoAxeViolations(page)
          await expectNoHorizontalScroll(page)
        }
      })

      test('sign-out not confirmed', async ({ page }) => {
        const { api } = await harness(page)
        await page.goto('/connexion')
        await signIn(page)
        await waitForCatalogState(page, 'nominal')
        api.failRevocations(1)
        if (size.name === 'desktop') {
          await openAccountMenu(page)
          await page.getByRole('button', { name: 'Se déconnecter' }).first().click()
        } else {
          await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Se déconnecter' }).click()
        }
        await expect(page.getByRole('alert').filter({ hasText: 'Déconnexion non confirmée.' })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await expectNoAxeViolations(page)
        await expectNoHorizontalScroll(page)
      })
    })
  }
}
