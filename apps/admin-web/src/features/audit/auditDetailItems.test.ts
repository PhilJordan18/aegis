import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../i18n/format'
import { MESSAGES } from '../../i18n/messages'
import type { I18n } from '../../i18n/useI18n'
import { detailItems, type DetailItem, type DetailValueView } from './auditDetailItems'
import * as sample from './auditDetailSamples'
import { parseAuditDetails } from './contractParsers'

const i18n = (locale: 'fr' | 'en'): I18n => ({ locale, m: MESSAGES[locale], format: formattersFor(locale) })
const items = (details: unknown, locale: 'fr' | 'en' = 'fr') => detailItems(parseAuditDetails(details), i18n(locale))
const plain = (value: string) => value.replace(/[\u00A0\u202F]/g, ' ')
const shown = (value: DetailValueView) => (value.code === null ? value.text : `${value.text} ${value.code}`)
/** « label : avant → après » for a change, « label : value » for a row, « label : a, b » for a list. */
const line = (item: DetailItem) =>
  `${item.label ?? item.key} : ${item.kind === 'row' ? shown(item.value) : item.kind === 'change' ? `${shown(item.before)} → ${shown(item.after)}` : item.values.map(shown).join(', ')}`

describe('a catalog update (changes.X.{from,to})', () => {
  it('reads « champ : avant → après », with a label for the state and its code beside it', () => {
    expect(items(sample.ASSET_UPDATED_STATUS).map(line)).toEqual(['État de service : En service SERVICEABLE → En maintenance MAINTENANCE'])
    expect(items(sample.ASSET_UPDATED_STATUS, 'en').map(line)).toEqual(['Service state : In service SERVICEABLE → In maintenance MAINTENANCE'])
  })

  it('lists the changed fields in the allowlist order, not the order the server sent', () => {
    expect(items(sample.ASSET_UPDATED_SERIAL_LEVEL).map((item) => item.label)).toEqual(['Numéro de série', 'Niveau d’accès requis', 'État de service'])
    expect(items(sample.ASSET_UPDATED_SERIAL_LEVEL).map(line)[1]).toBe('Niveau d’accès requis : Standard STANDARD → Restreint RESTRICTED')
  })

  it('writes a cleared or added value explicitly: null, booleans, and an instant in the laboratory zone', () => {
    const [status, required, due] = items(sample.ASSET_UPDATED_CALIBRATION)
    expect(due).toMatchObject({ kind: 'change', label: 'Échéance de calibration', before: { text: 'Non renseigné' }, after: { instant: '2027-06-30T04:00:00Z' } })
    expect(plain(due?.kind === 'change' ? due.after.text : '')).toMatch(/2027/)
    expect(plain(due?.kind === 'change' ? due.after.text : '')).toMatch(/30 juin 2027, 0 h 00/)
    expect(status && line(status)).toBe('État de service : En service SERVICEABLE → Endommagé DAMAGED')
    expect(required && line(required)).toBe('Calibration requise : Non → Oui')
  })

  it('shows prose as text and a code or identifier in the code style', () => {
    const [change] = items({ changes: { name: { from: 'Fluke 115', to: 'Fluke 117' }, serialNumber: { from: 'A', to: 'B' } } })
    expect(change).toMatchObject({ kind: 'change', before: { raw: false }, after: { raw: false } })
    const serial = items({ changes: { serialNumber: { from: 'A', to: 'B' } } })[0]
    expect(serial).toMatchObject({ before: { raw: true }, after: { raw: true } })
  })

  it('says a missing side is absent and never invents a value', () => {
    expect(items({ changes: { name: { to: 'Only after' } } }).map(line)).toEqual(['Nom : Aucun → Only after'])
  })
})

describe('what was created, revoked and assigned', () => {
  it('names the scope in front of each field', () => {
    const lines = items(sample.ASSET_CREATED_UNIT).map(line)
    expect(lines).toContain('Créé · Code de l’exemplaire : AEG-DEMO-005')
    expect(lines).toContain('Créé · État de service : En maintenance MAINTENANCE')
    expect(lines).toContain('Créé · Calibration requise : Oui')
    expect(lines).toContain('Créé · Niveau d’accès requis : Standard STANDARD')
    expect(items(sample.ASSET_CREATED_MODEL, 'en').map(line)).toContain('Created · Manufacturer : Fluke')
  })

  it('lists the created fields in the allowlist order', () => {
    expect(items(sample.ASSET_CREATED_UNIT).map((item) => item.label?.replace('Créé · ', ''))).toEqual([
      'Identifiant du modèle', 'Code de l’exemplaire', 'Numéro de série', 'Niveau d’accès requis', 'État de service', 'Calibration requise', 'Échéance de calibration',
    ])
  })

  it('reads an assignment and a revocation with the identifier type labelled', () => {
    expect(items(sample.ASSET_IDENTIFIER_ASSIGNED).map(line)[1]).toBe('Attribué · Type : NFC NFC')
    const revoked = items(sample.ASSET_UPDATED_REVOKED)
    expect(revoked.map((item) => item.label)).toEqual(["Révoqué · Identifiant de l'équipement", 'Révoqué · Type', 'Révoqué le'])
    expect(revoked[2]).toMatchObject({ kind: 'row', value: { instant: expect.any(String) } })
    expect(items(sample.ASSET_IDENTIFIER_ASSIGNED, 'en').map((item) => item.label)).toEqual(['Assigned · Equipment ID', 'Assigned · Type'])
  })
})

describe('a placement', () => {
  it('pairs each field before and after', () => {
    const lines = items(sample.ASSET_PLACEMENT_MOVED).map(line)
    expect(lines).toContain('Code du casier : AEGIS-DEMO-01 → AEGIS-DEMO-01')
    expect(lines).toContain('Code de la cellule : A1 → A2')
    expect(items(sample.ASSET_PLACEMENT_MOVED).map((item) => item.label)).toEqual(['Identifiant du placement', 'Identifiant du casier', 'Code du casier', 'Identifiant de la cellule', 'Code de la cellule', 'Placé le'])
  })

  it('says there was no placement before the first one, and none after the last', () => {
    expect(items(sample.ASSET_PLACEMENT_FIRST).map(line)).toContain('Code de la cellule : Aucun → A2')
    expect(items(sample.ASSET_PLACEMENT_ENDED, 'en').map(line)).toContain('Compartment code : A2 → None')
  })
})

describe('a schedule', () => {
  it('shows each day once with its hours before and after', () => {
    const lines = items(sample.SCHEDULE_UPDATED_CHANGED).map(line)
    expect(lines).toContain('Lundi : 07:00 – 18:00 → 07:00 – 19:30')
    expect(lines).toContain('Vendredi : 07:00 – 18:00 → 07:00 – 19:30')
    expect(lines).toContain('Samedi : Fermé toute la journée → Fermé toute la journée')
    expect(lines).toContain('Fuseau horaire : America/Toronto → America/Toronto')
    expect(lines.filter((entry) => /^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) :/.test(entry))).toHaveLength(7)
    expect(items(sample.SCHEDULE_UPDATED_CHANGED, 'en').map(line)).toContain('Monday : 07:00 – 18:00 → 07:00 – 19:30')
  })

  it('keeps the days in the order of the week and the previous schedule as a top-level row', () => {
    const labels = items(sample.SCHEDULE_UPDATED_CHANGED).map((item) => item.label)
    expect(labels.slice(0, 8)).toEqual(['Fuseau horaire', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'])
    expect(items(sample.SCHEDULE_UPDATED_CHANGED).at(-1)).toMatchObject({ kind: 'row', label: 'Plage horaire précédente' })
  })

  it('shows the first schedule against nothing', () => {
    const lines = items(sample.SCHEDULE_UPDATED_FIRST).map(line)
    expect(lines).toContain('Lundi : Aucun → 07:00 – 18:00')
    expect(lines).toContain('Dimanche : Aucun → Fermé toute la journée')
  })

  it('matches a day by its name, not by its position', () => {
    const swapped = {
      before: { windows: [{ dayOfWeek: 'MONDAY', enabled: true, opensAt: '07:00:00', closesAt: '18:00:00' }, { dayOfWeek: 'TUESDAY', enabled: false, opensAt: null, closesAt: null }] },
      after: { windows: [{ dayOfWeek: 'TUESDAY', enabled: true, opensAt: '08:00:00', closesAt: '12:30:15' }, { dayOfWeek: 'MONDAY', enabled: true, opensAt: '07:00:00', closesAt: '18:00:00' }] },
    }
    expect(items(swapped).map(line)).toEqual(['Lundi : 07:00 – 18:00 → 07:00 – 18:00', 'Mardi : Fermé toute la journée → 08:00 – 12:30:15'])
  })
})

describe('a list of identifiers', () => {
  it('is one item, each identifier in the code style', () => {
    const [assetId, cancelledAt, reservedUntil, ended] = items(sample.RESERVATION_CANCELLED)
    expect(assetId).toMatchObject({ kind: 'row', label: "Identifiant de l'équipement" })
    expect(cancelledAt).toMatchObject({ kind: 'row', label: 'Annulé le' })
    expect(reservedUntil).toMatchObject({ kind: 'row', label: "Réservé jusqu'au" })
    expect(ended).toMatchObject({ kind: 'list', label: 'Opérations terminées' })
    expect(ended?.kind === 'list' && ended.values.map((value) => [value.text, value.raw])).toEqual([
      ['2f38d3b6-c18f-4a74-aa9a-2d574286013f', true],
      ['9a0b1c2d-3e4f-4a5b-8c6d-7e8f90a1b2c3', true],
    ])
  })

  it('has no item for an empty list', () => {
    expect(items(sample.RESERVATION_EXPIRED_NO_OPERATION).map((item) => item.key)).toEqual(['assetId', 'reservedUntil'])
  })
})

describe('what is not on the allowlist', () => {
  it('never reaches an item: it is counted by the parser and nothing is rendered', () => {
    const details = parseAuditDetails({ created: { name: 'Fluke', value: 'E20034120123456789000001', description: 'x' }, secret: { token: 'abc' } })
    expect(details.omitted).toBe(3)
    const rendered = JSON.stringify(detailItems(details, i18n('fr')))
    expect(rendered).not.toContain('E2003412')
    expect(rendered).not.toContain('abc')
    expect(rendered).not.toContain('description')
  })

  it('keeps a top-level scalar the catalog does not know, as sent', () => {
    expect(items({ other: 'x', severity: 'LOW' }).map((item) => [item.key, item.label])).toEqual([['other', null], ['severity', 'Gravité']])
  })

  it('has a French and an English label for every field the allowlist names', () => {
    const changed = ['name', 'manufacturer', 'modelNumber', 'defaultCalibrationRequired', 'assetModelId', 'assetCode', 'serialNumber', 'requiredAccessLevel', 'operationalStatus', 'calibrationRequired', 'calibrationDueAt']
    const placed = ['placementId', 'lockerId', 'lockerCode', 'compartmentId', 'compartmentCode', 'assignedAt']
    const named = (details: unknown, locale: 'fr' | 'en') => items(details, locale).map((item) => item.label)
    for (const locale of ['fr', 'en'] as const) {
      const labels = [
        ...named({ changes: Object.fromEntries(changed.map((field) => [field, { from: 'a', to: 'b' }])) }, locale),
        ...named({ revoked: { assetId: 'a', type: 'NFC' }, to: Object.fromEntries(placed.map((field) => [field, 'x'])), after: { timeZone: 'America/Toronto' }, endedOperationIds: ['a'] }, locale),
      ]
      expect(labels, locale).toHaveLength(changed.length + 2 + placed.length + 2)
      expect(labels.filter((label) => label === null || label === ''), locale).toEqual([])
      expect(new Set(labels).size, `${locale} labels are distinct`).toBe(labels.length)
    }
  })
})
