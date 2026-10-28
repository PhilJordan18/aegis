import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../app/routes'
import { en } from './en'
import { fr } from './fr'

type Leaf = string | ((params: Record<string, unknown>) => string)

/** `signIn.fieldError.emailRequired` → leaf. Objects are walked, strings and message functions are leaves. */
function leaves(node: object, prefix = ''): Map<string, Leaf> {
  const found = new Map<string, Leaf>()
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string' || typeof value === 'function') found.set(path, value as Leaf)
    else if (value !== null && typeof value === 'object') for (const [p, leaf] of leaves(value, path)) found.set(p, leaf)
    else throw new Error(`${path}: a catalog holds only strings, message functions and groups`)
  }
  return found
}

/** A stand-in that renders as «name» in a string and as 2 in a number, and records how it was read. */
function probe() {
  const read = new Map<string, { asText: boolean; asNumber: boolean }>()
  const params = new Proxy(
    {},
    {
      get(_target, name) {
        const key = String(name)
        const use = read.get(key) ?? { asText: false, asNumber: false }
        read.set(key, use)
        return {
          toString() {
            use.asText = true
            return `«${key}»`
          },
          valueOf() {
            use.asNumber = true
            return 2
          },
        }
      },
    },
  )
  return { params, read }
}

function placeholders(leaf: Leaf): { names: string[]; output: string; unused: string[] } {
  if (typeof leaf === 'string') return { names: [], output: leaf, unused: [] }
  const { params, read } = probe()
  const output = leaf(params as Record<string, unknown>)
  const names = [...read.keys()].sort()
  const unused = names.filter((name) => !output.includes(`«${name}»`) && !read.get(name)?.asNumber)
  return { names, output, unused }
}

const frLeaves = leaves(fr)
const enLeaves = leaves(en)

describe('catalog consistency (fr is the source of the shape)', () => {
  it('has exactly the same keys in French and English', () => {
    const onlyFr = [...frLeaves.keys()].filter((key) => !enLeaves.has(key))
    const onlyEn = [...enLeaves.keys()].filter((key) => !frLeaves.has(key))
    expect({ onlyFr, onlyEn }).toEqual({ onlyFr: [], onlyEn: [] })
    expect(frLeaves.size).toBeGreaterThan(80)
  })

  it('has the same kind of message (text or function) under each key', () => {
    for (const [key, leaf] of frLeaves) expect(typeof enLeaves.get(key), key).toBe(typeof leaf)
  })

  it('has the same placeholder names in each message, and uses every one of them', () => {
    for (const [key, frLeaf] of frLeaves) {
      const enLeaf = enLeaves.get(key)
      if (!enLeaf) continue
      const inFr = placeholders(frLeaf)
      const inEn = placeholders(enLeaf)
      expect(inEn.names, `placeholders of ${key}`).toEqual(inFr.names)
      expect(inFr.unused, `${key} (fr) ignores a placeholder`).toEqual([])
      expect(inEn.unused, `${key} (en) ignores a placeholder`).toEqual([])
    }
  })

  it('has no empty or blank message', () => {
    for (const [name, catalog] of [['fr', frLeaves], ['en', enLeaves]] as const) {
      for (const [key, leaf] of catalog) {
        expect(placeholders(leaf).output.trim().length, `${name}: ${key} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('has no message that is a key path instead of a text', () => {
    const keyPath = /^[a-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/
    for (const [name, catalog] of [['fr', frLeaves], ['en', enLeaves]] as const) {
      for (const [key, leaf] of catalog) expect(placeholders(leaf).output, `${name}: ${key}`).not.toMatch(keyPath)
    }
  })

  it('has a translated title for every route', () => {
    const routes = Object.keys(ROUTES).sort()
    expect(Object.keys(fr.pageTitle).sort()).toEqual(routes)
    expect(Object.keys(en.pageTitle).sort()).toEqual(routes)
  })

  it('keeps the product name in every page title and never translates it', () => {
    for (const catalog of [fr, en]) for (const title of Object.values(catalog.pageTitle)) expect(title).toContain('Aegis Manager')
  })

  it('does not leave an English message identical to French, except a product name and words that really match', () => {
    // Product name and words that really are the same in both languages.
    const shared = new Set(['pageTitle.landing', 'signIn.footerProduct', 'shell.sectionsLabel', 'shell.menuTitle', 'shell.sections.audit', 'shell.sections.anomalies', 'equipment.factCalibration', 'equipment.factPlacement', 'equipment.accessLevel.STANDARD'])
    const same = [...frLeaves]
      .filter(([key, leaf]) => typeof leaf === 'string' && enLeaves.get(key) === leaf && !shared.has(key))
      .map(([key]) => key)
    expect(same).toEqual([])
  })

  it('writes punctuation the way each language does', () => {
    expect(fr.signIn.roleAccountUsed).toMatch(/\u00A0:$/)
    expect(fr.signIn.traceIdLabel).toMatch(/\u00A0:$/)
    expect(fr.signIn.footerTechnician).toContain('\u00A0?')
    expect(en.signIn.roleAccountUsed).toMatch(/[a-z]:$/)
    expect(en.signIn.traceIdLabel).toMatch(/[A-Za-z]:$/)
    expect(en.signIn.footerTechnician).toContain('Technician?')
    expect(fr.landing.footerTechnician).toContain('\u00A0?')
    expect(en.landing.footerTechnician).toContain('Technician?')
  })
})

describe('brand texts (decided by Philippe, 2026-10-21)', () => {
  it('has the common signature, the tagline and the description in both languages', () => {
    expect(Object.values(fr.brand.signature).join(' ')).toBe('Prêt. Autorisé. Prouvé.')
    expect(Object.values(en.brand.signature).join(' ')).toBe('Ready. Authorized. Proven.')
    expect(fr.brand.tagline).toBe('L’essentiel, sous contrôle.')
    expect(en.brand.tagline).toBe('What matters, under control.')
    expect(fr.brand.description).toBe('Disponibilité, conformité et traçabilité de vos équipements.')
    expect(en.brand.description).toBe('Equipment availability, compliance and traceability.')
  })

  it('names the mobile application Aegis Mobile in both footers, and no longer shows the old hero words', () => {
    for (const catalog of [fr, en]) {
      expect(catalog.signIn.footerTechnician).toContain('Aegis Mobile')
      expect(catalog.landing.footerTechnician).toContain('Aegis Mobile')
    }
    const everything = JSON.stringify([fr, en])
    expect(everything).not.toMatch(/Observé|Observed|Tracé|Traced/)
  })

  it('has no key for the countdown caption: the Retry-After delay is shown once, in the alert', () => {
    expect(Object.keys(fr.signIn)).not.toContain('rateLimitedHint')
    expect(Object.keys(en.signIn)).not.toContain('rateLimitedHint')
  })
})

describe('message functions', () => {
  it('builds each sentence in one piece, with the inserted value last-formatted', () => {
    expect(fr.signIn.rateLimitedBody({ duration: '42 secondes' })).toBe('Réessayez dans 42 secondes.')
    expect(en.signIn.rateLimitedBody({ duration: '42 seconds' })).toBe('Try again in 42 seconds.')
    expect(fr.landing.calibrationExpired({ date: '8 sept. 2026' })).toBe('Calibration expirée depuis le 8 sept. 2026')
    expect(en.landing.calibrationExpired({ date: 'Sep 8, 2026' })).toBe('Calibration expired on Sep 8, 2026')
  })

  it('selects plural forms with the CLDR rules of each language', () => {
    const plain = (value: string) => value.replace(/[\u00A0\u202F]/g, ' ')
    expect([0, 1, 2].map((count) => plain(fr.landing.blockers({ count })))).toEqual(['0 empêchement', '1 empêchement', '2 empêchements'])
    expect([0, 1, 2].map((count) => plain(en.landing.blockers({ count })))).toEqual(['0 blockers', '1 blocker', '2 blockers'])
  })
})
