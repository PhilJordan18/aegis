import { expect, test, type Locator, type Page } from '@playwright/test'
import { PREVIEW_EMAIL, PREVIEW_PASSWORD, settle } from './support.ts'

/**
 * Identity v3 (issue #79) measured on the rendered app: layout shift when a global error
 * appears, contrast of what is actually painted, visible focus, and clipped text.
 * The numbers are printed so a review can quote them.
 */

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
  { name: 'zoom200', width: 640, height: 400 },
] as const

type Rect = { x: number; y: number; width: number; height: number }

async function rectOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box')
  return box
}

async function formRects(page: Page) {
  return {
    email: await rectOf(page.getByLabel(/Adresse courriel|Email address/)),
    password: await rectOf(page.getByLabel(/^(Mot de passe|Password)$/)),
    button: await rectOf(page.locator('button[type="submit"]')),
  }
}

const STATES = [
  ['identifiants-refuses', 'invalidCredentials'],
  ['trop-de-tentatives', 'rateLimited'],
  ['service-injoignable', 'unreachable'],
  ['erreur-service', 'serviceError'],
] as const

test.describe('layout shift when a global error appears', () => {
  for (const size of SIZES) {
    for (const [scenario, state] of STATES) {
      test(`${size.name} ${scenario}: the fields and the button do not move`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height })
        await page.goto(`/connexion?apercu=${scenario}`)
        await settle(page)
        await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
        await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
        await page.evaluate(() => window.scrollTo(0, 0))
        const before = await formRects(page)
        await page.locator('button[type="submit"]').click()
        await page.locator(`form[data-state="${state}"]`).waitFor()
        await page.evaluate(() => window.scrollTo(0, 0))
        const after = await formRects(page)
        const shift = Math.max(
          ...(['email', 'password', 'button'] as const).flatMap((key) => [
            Math.abs(after[key].x - before[key].x),
            Math.abs(after[key].y - before[key].y),
            Math.abs(after[key].width - before[key].width),
            Math.abs(after[key].height - before[key].height),
          ]),
        )
        console.log(`LAYOUT-SHIFT ${size.name} ${scenario}: ${shift} px`)
        expect(shift).toBe(0)

        const alert = page.getByRole('alert')
        await expect(alert).toBeVisible()
        // The message is below the button and stays reachable without scrolling the page away from it.
        expect((await rectOf(alert)).y).toBeGreaterThan(after.button.y + after.button.height)
      })
    }
  }
})

// Linearised sRGB luminance and WCAG ratio, from the colours the browser actually painted.
function ratio(a: [number, number, number], b: [number, number, number]): number {
  const lum = (c: [number, number, number]) => {
    const [r, g, bl] = c.map((v) => {
      const x = v / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** First opaque background walking up from the element, and the element's own property colour. */
async function paint(locator: Locator, property: 'color' | 'borderTopColor' | 'outlineColor') {
  return locator.evaluate((element, prop) => {
    const parse = (value: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(value)
      if (!m) return [0, 0, 0, 0]
      const parts = (m[1] as string).split(/[ ,/]+/).filter(Boolean).map(Number)
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
    }
    let node: Element | null = element
    let background: [number, number, number, number] = [255, 255, 255, 1]
    while (node) {
      const value = parse(getComputedStyle(node).backgroundColor)
      if (value[3] === 1) {
        background = value
        break
      }
      node = node.parentElement
    }
    const own = parse(getComputedStyle(element)[prop as 'color'])
    return { foreground: own.slice(0, 3) as [number, number, number], background: background.slice(0, 3) as [number, number, number] }
  }, property)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`rendered contrast, ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1440, height: 900 } })

    test('sign-in: text 4.5:1 and controls 3:1 as painted', async ({ page }) => {
      await page.goto('/connexion?apercu=identifiants-refuses')
      await settle(page)
      await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
      await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
      await page.locator('button[type="submit"]').click()
      await page.locator('form[data-state="invalidCredentials"]').waitFor()

      const text: [string, Locator][] = [
        ['title', page.getByRole('heading', { level: 1 })],
        ['eyebrow', page.locator('.ag-signin__eyebrow')],
        ['subtitle', page.locator('.ag-signin__sub')],
        ['label', page.locator('.ag-field__label').first()],
        ['input text', page.getByLabel('Adresse courriel')],
        ['reveal', page.locator('.ag-field__reveal')],
        ['button label', page.locator('button[type="submit"]')],
        ['alert title', page.locator('.ag-alert__title')],
        ['alert body', page.locator('.ag-alert__body')],
        ['note', page.locator('.ag-signin__mention')],
        ['tagline', page.locator('.ag-promise__tagline')],
        ['signature', page.locator('.ag-promise__line').first()],
        ['signature accent', page.locator('.ag-promise__line--proof')],
        ['description', page.locator('.ag-promise__description')],
        ['home link', page.locator('.ag-signin__home')],
        ['footer', page.locator('.ag-signin__foot p').first()],
        ['brand app name', page.locator('.ag-brand__app')],
        ['language selected', page.locator('.ag-segmented__option:has(input:checked)').first()],
        ['language other', page.locator('.ag-segmented__option:has(input:not(:checked))').first()],
      ]
      for (const [name, locator] of text) {
        const { foreground, background } = await paint(locator, 'color')
        const value = ratio(foreground, background)
        console.log(`CONTRAST ${theme} text ${name}: ${value.toFixed(2)}`)
        expect(value, name).toBeGreaterThanOrEqual(4.5)
      }

      const fieldControl = page.locator('.ag-field__control').first()
      const card = await paint(page.locator('.ag-signin__card'), 'borderTopColor')
      const border = await paint(fieldControl, 'borderTopColor')
      const against = (await paint(fieldControl, 'color')).background
      const controls: [string, number][] = [
        ['field border on the card', ratio(border.foreground, card.background)],
        ['field border on the field fill', ratio(border.foreground, against)],
      ]
      await page.getByLabel('Adresse courriel').focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      const ring = await paint(fieldControl, 'outlineColor')
      controls.push(['focus ring on the card', ratio(ring.foreground, card.background)])
      for (const [name, value] of controls) {
        console.log(`CONTRAST ${theme} component ${name}: ${value.toFixed(2)}`)
        expect(value, name).toBeGreaterThanOrEqual(3)
      }
    })
  })
}

test.describe('visible focus and clipped text', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('every sign-in tab stop shows a solid 2 px outline offset 2 px', async ({ page }) => {
    await page.goto('/connexion')
    await settle(page)
    const seen: string[] = []
    async function checkStop() {
      const style = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement
        // A field draws its ring on its control and a language option on its label; every other stop on itself.
        const target = (element.tagName === 'INPUT' && (element.closest('.ag-field__control') ?? element.closest('.ag-segmented__option'))) || element
        const computed = getComputedStyle(target)
        return { label: element.getAttribute('aria-label') ?? element.id ?? element.tagName, width: computed.outlineWidth, style: computed.outlineStyle, offset: computed.outlineOffset }
      })
      seen.push(style.label)
      expect(style, style.label).toMatchObject({ width: '2px', style: 'solid', offset: '2px' })
    }
    // Header stops (brand, « Accueil », language), then the form stops (email, password, reveal, submit).
    await page.getByRole('link', { name: 'Aegis Manager, accueil' }).focus()
    for (let step = 0; step < 3; step += 1) {
      await checkStop()
      await page.keyboard.press('Tab')
    }
    for (let step = 0; step < 4; step += 1) {
      await checkStop()
      if (step < 3) await page.keyboard.press('Tab')
    }
    console.log(`FOCUS stops: ${seen.join(' > ')}`)
  })

  for (const size of SIZES) {
    test(`${size.name}: no clipped text on the entry screens`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      for (const path of ['/', '/connexion?apercu=erreur-service', '/apercu/equipements']) {
        await page.goto(path)
        await settle(page)
        if (path.includes('erreur-service')) {
          await page.getByLabel('Adresse courriel').fill(PREVIEW_EMAIL)
          await page.getByLabel('Mot de passe', { exact: true }).fill(PREVIEW_PASSWORD)
          await page.locator('button[type="submit"]').click()
          await page.locator('code').waitFor()
        }
        const clipped = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((element) => {
              const style = getComputedStyle(element)
              if (element.getBoundingClientRect().width <= 1 || style.visibility === 'hidden' || style.display === 'none') return false
              const clips = ['hidden', 'clip'].includes(style.overflowX)
              return clips && element.scrollWidth > element.clientWidth + 1 && element.textContent?.trim() !== ''
            })
            .map((element) => element.className || element.tagName),
        )
        expect(clipped, `${path} at ${size.name}`).toEqual([])
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, `${path} horizontal scroll at ${size.name}`).toBeLessThanOrEqual(0)
      }
    })
  }
})
