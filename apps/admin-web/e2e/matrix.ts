import type { Page } from '@playwright/test'
import { afterSubmit, submitSignIn } from './support.ts'

export interface Viewport {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly deviceScaleFactor: number
}

export const VIEWPORTS: readonly Viewport[] = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: 'laptop', width: 1280, height: 800, deviceScaleFactor: 1 },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 3 },
  { name: 'reflow', width: 320, height: 720, deviceScaleFactor: 2 },
  // A 1280×800 window at 200 % browser zoom: 640×400 CSS pixels at twice the density.
  { name: 'zoom200', width: 640, height: 400, deviceScaleFactor: 2 },
]

export interface ThemeCase {
  readonly name: string
  readonly colorScheme: 'light' | 'dark'
  /** Stored appearance preference, applied before first paint; null keeps the default (system). */
  readonly preference: 'light' | 'dark' | null
  readonly forcedColors?: 'active'
  readonly expectedTheme: 'light' | 'dark'
  /** Forced cases prove an override; one viewport is enough. */
  readonly viewports: 'all' | readonly string[]
}

export const THEMES: readonly ThemeCase[] = [
  { name: 'light', colorScheme: 'light', preference: null, expectedTheme: 'light', viewports: 'all' },
  { name: 'dark', colorScheme: 'dark', preference: null, expectedTheme: 'dark', viewports: 'all' },
  { name: 'forced-dark', colorScheme: 'light', preference: 'dark', expectedTheme: 'dark', viewports: ['desktop'] },
  { name: 'forced-light', colorScheme: 'dark', preference: 'light', expectedTheme: 'light', viewports: ['desktop'] },
  { name: 'forced-colors', colorScheme: 'light', preference: null, forcedColors: 'active', expectedTheme: 'light', viewports: ['desktop'] },
]

export interface Scenario {
  readonly route: string
  readonly state: string
  readonly path: string
  /** Brings the page into the state to inspect, after navigation. */
  readonly reach?: (page: Page) => Promise<void>
}

export const SCENARIOS: readonly Scenario[] = [
  { route: 'landing', state: 'defaut', path: '/' },
  { route: 'connexion', state: 'inactif', path: '/connexion' },
  {
    route: 'connexion',
    state: 'validation-client',
    path: '/connexion',
    reach: async (page) => {
      await page.getByLabel('Adresse courriel').fill('admin@aegis')
      await page.getByRole('button', { name: 'Se connecter' }).click()
      await page.locator('[aria-invalid="true"]').first().waitFor()
    },
  },
  { route: 'connexion', state: 'envoi', path: '/connexion?apercu=envoi', reach: afterSubmit('submitting') },
  { route: 'connexion', state: 'identifiants-refuses', path: '/connexion?apercu=identifiants-refuses', reach: afterSubmit('invalidCredentials') },
  { route: 'connexion', state: 'trop-de-tentatives', path: '/connexion?apercu=trop-de-tentatives', reach: afterSubmit('rateLimited') },
  { route: 'connexion', state: 'service-injoignable', path: '/connexion?apercu=service-injoignable', reach: afterSubmit('unreachable') },
  { route: 'connexion', state: 'erreur-service', path: '/connexion?apercu=erreur-service', reach: afterSubmit('serviceError') },
  { route: 'connexion', state: 'validation', path: '/connexion?apercu=validation', reach: afterSubmit('validation') },
  {
    route: 'connexion',
    state: 'role-non-autorise',
    path: '/connexion?apercu=role-non-autorise',
    reach: async (page) => {
      await submitSignIn(page)
      await page.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' }).waitFor()
    },
  },
  { route: 'connexion', state: 'session-expiree', path: '/connexion?apercu=session-expiree' },
  { route: 'connexion', state: 'session-invalide', path: '/connexion?apercu=session-invalide' },
  { route: 'connexion', state: 'deconnecte', path: '/connexion?apercu=deconnecte' },
  { route: 'apercu-equipements', state: 'nominal', path: '/apercu/equipements' },
  {
    route: 'apercu-equipements',
    state: 'menu-compte',
    path: '/apercu/equipements',
    reach: async (page) => {
      const sidebar = page.getByRole('navigation', { name: 'Sections' })
      if (await sidebar.isVisible()) {
        await sidebar.getByRole('button', { name: /Administrateur Démo/ }).click()
      } else {
        await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
      }
      await page.getByRole('radio', { name: 'Système' }).first().waitFor({ state: 'visible' })
    },
  },
  { route: 'introuvable', state: 'defaut', path: '/nulle-part' },
]
