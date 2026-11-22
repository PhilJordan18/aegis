import { describe, expect, it } from 'vitest'
import { RETURN_PARAMETER, returnPathFromSearch, safeReturnPath, signInPathFor } from './returnPath'

describe('safeReturnPath', () => {
  it.each(['/vue-d-ensemble', '/equipements', '/reservations-prets', '/casiers', '/anomalies', '/audit'])('accepts the protected page %s', (path) => {
    expect(safeReturnPath(path)).toBe(path)
  })

  it('keeps the query and drops the fragment', () => {
    expect(safeReturnPath('/equipements?q=MM-002&page=2#dossier')).toBe('/equipements?q=MM-002&page=2')
  })

  it('tolerates a trailing slash like the router', () => {
    expect(safeReturnPath('/casiers/')).toBe('/casiers/')
  })

  it.each([
    ['nothing', null],
    ['an empty string', ''],
    ['an absolute URL', 'https://evil.example/audit'],
    ['a scheme-relative URL', '//evil.example/audit'],
    ['a scheme-relative URL on a protected path', '//evil.example/casiers'],
    ['a backslash host (browsers read it as //)', '/\\evil.example'],
    ['a backslash after a protected path', '/audit\\..\\x'],
    ['a tab hidden in the slashes', '/\t/evil.example'],
    ['a newline', '/audit\n'],
    ['a NUL', '/audit\u0000'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a relative path', 'audit'],
    ['the sign-in page (no loop)', '/connexion'],
    ['the sign-in page with a nested return', '/connexion?retour=%2Fcasiers'],
    ['a dot-segment path that resolves to the sign-in page', '/casiers/../connexion'],
    ['the landing page', '/'],
    ['an unknown page', '/inconnu'],
    ['a preview page', '/apercu/equipements'],
    ['a protected page prefix only', '/audit-secret'],
    ['an overlong value', `/audit?q=${'a'.repeat(3000)}`],
  ])('refuses %s', (_name, value) => {
    expect(safeReturnPath(value)).toBeNull()
  })

  it('treats an encoded slash pair as a path segment, not a host', () => {
    expect(safeReturnPath('/%2F%2Fevil.example')).toBeNull()
  })
})

describe('returnPathFromSearch', () => {
  it('reads the validated parameter', () => {
    expect(returnPathFromSearch(`?${RETURN_PARAMETER}=%2Fcasiers%3Fx%3D1`)).toBe('/casiers?x=1')
  })

  it('ignores a missing or unsafe parameter', () => {
    expect(returnPathFromSearch('')).toBeNull()
    expect(returnPathFromSearch('?apercu=connecte')).toBeNull()
    expect(returnPathFromSearch(`?${RETURN_PARAMETER}=${encodeURIComponent('//evil.example')}`)).toBeNull()
  })
})

describe('signInPathFor', () => {
  it('remembers a protected page, query included', () => {
    expect(signInPathFor({ pathname: '/equipements', search: '?q=MM-002' })).toBe('/connexion?retour=%2Fequipements%3Fq%3DMM-002')
  })

  it('does not remember anything else', () => {
    expect(signInPathFor({ pathname: '/', search: '' })).toBe('/connexion')
    expect(signInPathFor({ pathname: '/connexion', search: '?retour=%2Faudit' })).toBe('/connexion')
    expect(signInPathFor({ pathname: '/inconnu', search: '' })).toBe('/connexion')
  })

  it('round-trips through the sign-in page search', () => {
    const path = signInPathFor({ pathname: '/reservations-prets', search: '?statut=ACTIVE' })
    expect(returnPathFromSearch(path.slice(path.indexOf('?')))).toBe('/reservations-prets?statut=ACTIVE')
  })
})
