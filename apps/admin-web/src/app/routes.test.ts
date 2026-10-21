import { describe, expect, it } from 'vitest'
import { matchRoute, pathOf } from './routes'

describe('matchRoute', () => {
  it('matches the public routes', () => {
    expect(matchRoute('/', false)).toBe('landing')
    expect(matchRoute('/connexion', false)).toBe('signIn')
    expect(matchRoute('/connexion/', false)).toBe('signIn')
  })

  it('serves the protected equipment route in every build', () => {
    expect(matchRoute('/equipements', false)).toBe('equipment')
    expect(matchRoute('/equipements', true)).toBe('equipment')
  })

  it('serves preview routes only when the preview is enabled', () => {
    expect(matchRoute('/apercu/equipements', true)).toBe('equipmentPreview')
    expect(matchRoute('/apercu/equipements', false)).toBe('notFound')
  })

  it('falls back to not found', () => {
    expect(matchRoute('/inconnu', true)).toBe('notFound')
    expect(matchRoute('/CONNEXION', true)).toBe('notFound')
  })

  it('builds paths from ids', () => {
    expect(pathOf('signIn')).toBe('/connexion')
  })
})
