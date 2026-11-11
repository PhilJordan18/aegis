import { describe, expect, it } from 'vitest'
import { formattersFor } from '../../i18n/format'
import { MESSAGES } from '../../i18n/messages'
import type { I18n } from '../../i18n/useI18n'
import { parseAuditDetails } from './contractParsers'
import { actorView, detailRows, eventLabel, groupByDay, resultChip, shortId, stateLabel, subjectLabel } from './auditPresentation'
import { eventView, uuid } from './testFixtures'

const i18n = (locale: 'fr' | 'en'): I18n => ({ locale, m: MESSAGES[locale], format: formattersFor(locale) })

describe('labels from codes', () => {
  it('labels a known event type in each language and keeps an unknown code visible', () => {
    expect(eventLabel('COMMAND_SENT', i18n('fr'))).toBe('Commande envoyée au casier')
    expect(eventLabel('COMMAND_SENT', i18n('en'))).toBe('Command sent to the locker')
    expect(eventLabel('FUTURE_EVENT', i18n('fr'))).toBe('Événement non reconnu · FUTURE_EVENT')
    expect(eventLabel('FUTURE_EVENT', i18n('en'))).toBe('Unrecognized event · FUTURE_EVENT')
  })

  it('never takes an object key for a code', () => {
    expect(eventLabel('constructor', i18n('en'))).toBe('Unrecognized event · constructor')
    expect(eventLabel('__proto__', i18n('en'))).toBe('Unrecognized event · __proto__')
    expect(subjectLabel('toString', i18n('en'))).toBe('toString')
  })

  it('labels subjects and states, with the raw subject code or an unrecognized state when unknown', () => {
    expect(subjectLabel('LOCKER_OPERATION', i18n('fr'))).toBe('Opération')
    expect(subjectLabel('NEW_SUBJECT', i18n('fr'))).toBe('NEW_SUBJECT')
    expect(stateLabel('OPEN', i18n('en'))).toBe('Open')
    expect(stateLabel('WEIRD', i18n('en'))).toBe('Unrecognized state · WEIRD')
  })

  it('has a label for every event type the database admits', () => {
    // V002_2 ck_audit_events_type: a code without a label would show as unrecognized although it is known.
    const admitted = [
      'AUTHENTICATION_SUCCEEDED', 'AUTHENTICATION_REJECTED', 'ASSET_CREATED', 'ASSET_UPDATED', 'ASSET_ARCHIVED', 'ASSET_IDENTIFIER_ASSIGNED', 'ASSET_PLACEMENT_CHANGED',
      'SCHEDULE_UPDATED', 'READINESS_EVALUATED', 'RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'RESERVATION_FULFILLED', 'RESERVATION_EXPIRED', 'OPERATION_REQUESTED',
      'OPERATION_AUTHORIZED', 'LOCAL_CHALLENGE_CREATED', 'LOCAL_CHALLENGE_DISPLAYED', 'LOCAL_CHALLENGE_CONSUMED', 'LOCAL_CHALLENGE_REJECTED', 'LOCAL_CHALLENGE_EXPIRED',
      'LOCAL_CHALLENGE_INVALIDATED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'COMMAND_REJECTED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'OPERATION_CONFIRMED',
      'OPERATION_FAILED', 'OPERATION_EXPIRED', 'LOAN_RETURN_STARTED', 'LOAN_RETURN_REVERTED_SAFE', 'LOAN_COMPLETED', 'ANOMALY_CREATED', 'ANOMALY_ACKNOWLEDGED',
      'ANOMALY_RESOLVED', 'CHECKOUT_CONFIRMED', 'RETURN_CONFIRMED', 'MQTT_MESSAGE_DUPLICATE_IGNORED', 'LOCKER_ONLINE', 'LOCKER_OFFLINE',
    ]
    for (const locale of ['fr', 'en'] as const) for (const code of admitted) expect(eventLabel(code, i18n(locale)), `${locale} ${code}`).not.toContain('·')
  })
})

describe('actorView', () => {
  it('shows the display name, « Système » for no actor and an explicit unreadable label otherwise', () => {
    expect(actorView({ id: uuid(1), displayName: 'Administrateur Démo' }, i18n('fr'))).toEqual({ kind: 'user', name: 'Administrateur Démo', id: uuid(1) })
    expect(actorView(null, i18n('fr')).name).toBe('Système')
    expect(actorView(null, i18n('en')).name).toBe('System')
    expect(actorView({ kind: 'unreadable' }, i18n('fr'))).toEqual({ kind: 'unreadable', name: 'Acteur illisible' })
    expect(actorView({ kind: 'unreadable' }, i18n('en')).name).toBe('Unreadable actor')
  })
})

describe('resultChip', () => {
  it('carries each result by shape, symbol and text, and shows an unknown code as it is', () => {
    expect(resultChip('ACCEPTED', i18n('fr'))).toEqual({ role: 'ready', icon: 'status-ready', label: 'Accepté' })
    expect(resultChip('REJECTED', i18n('en'))).toEqual({ role: 'blocked', icon: 'status-blocked', label: 'Rejected' })
    expect(resultChip('CONFLICT', i18n('en'))?.icon).toBe('status-warn')
    expect(resultChip('SOMETHING_NEW', i18n('en'))?.label).toBe('Result: SOMETHING_NEW')
    expect(resultChip(null, i18n('fr'))).toBeNull()
  })
})

describe('groupByDay', () => {
  it('groups consecutive events by laboratory day and never reorders them', () => {
    const late = eventView(1, { occurredAt: '2026-11-12T03:30:00Z' }) // 22:30 on the 11th in Toronto
    const sameDay = eventView(2, { occurredAt: '2026-11-11T15:00:00Z' })
    const earlier = eventView(3, { occurredAt: '2026-11-10T15:00:00Z' })
    const groups = groupByDay([late, sameDay, earlier], i18n('fr'))
    expect(groups.map((group) => [group.day, group.events.map((event) => event.id)])).toEqual([
      ['2026-11-11', [late.id, sameDay.id]],
      ['2026-11-10', [earlier.id]],
    ])
    expect(groups[0]?.heading).toBe('mercredi 11 novembre 2026')
  })

  it('shortens an identifier for a row', () => {
    expect(shortId(uuid(123))).toBe('00000000…')
  })
})

describe('detail rows', () => {
  const rows = (details: unknown, locale: 'fr' | 'en') => detailRows(parseAuditDetails(details), i18n(locale))

  it('labels a key of the backend allowlist in each language and keeps another key as sent', () => {
    expect(rows({ severity: 'LOW', other: 'x' }, 'fr').map((row) => [row.key, row.label])).toEqual([['severity', 'Gravité'], ['other', null]])
    expect(rows({ severity: 'LOW' }, 'en')[0]?.label).toBe('Severity')
    expect(rows(JSON.parse('{"toString":"x","__proto__":"y"}'), 'en').map((row) => row.label)).toEqual([null, null])
  })

  it('shows values as sent, with a label only for a state, a result or an instant of the allowlist', () => {
    const [outcome, status, unknownStatus, type, reservedUntil, other] = rows(
      { outcome: 'ACCEPTED', status: 'ACTIVE', operationStatus: 'WEIRD', type: 'UNEXPECTED_ASSET_OBSERVED', reservedUntil: '2026-11-11T20:00:00Z', note: '2026-11-11T20:00:00Z' },
      'en',
    )
    expect(outcome).toMatchObject({ text: 'Accepted', code: 'ACCEPTED' })
    expect(status).toMatchObject({ text: 'Active', code: 'ACTIVE' })
    expect(unknownStatus).toMatchObject({ text: 'WEIRD', code: null, raw: true })
    expect(type).toMatchObject({ text: 'UNEXPECTED_ASSET_OBSERVED', code: null, raw: true })
    expect(reservedUntil?.instant).toBe('2026-11-11T20:00:00Z')
    expect(reservedUntil?.text).toMatch(/2026/)
    expect(other).toMatchObject({ text: '2026-11-11T20:00:00Z', instant: null })
  })

  it('writes booleans, null and numbers explicitly and never a structured value', () => {
    const list = rows({ a: true, b: false, c: null, d: 3, e: { x: 1 }, f: [1] }, 'fr')
    expect(list.map((row) => row.text)).toEqual(['Oui', 'Non', 'Non renseigné', '3'])
    expect(rows({ a: true }, 'en')[0]?.text).toBe('Yes')
  })
})
