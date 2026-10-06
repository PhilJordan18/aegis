/**
 * Typed route map. Paths are French because they are visible to users; ids stay English.
 * Preview-only routes resolve to `notFound` when the preview is disabled.
 */
export type RouteId = 'landing' | 'signIn' | 'equipmentPreview' | 'notFound'

export interface RouteDefinition {
  readonly path: string | null
  readonly title: string
  readonly previewOnly: boolean
}

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = {
  landing: { path: '/', title: 'Aegis Manager', previewOnly: false },
  signIn: { path: '/connexion', title: 'Connexion — Aegis Manager', previewOnly: false },
  equipmentPreview: { path: '/apercu/equipements', title: 'Équipements — Aegis Manager', previewOnly: true },
  notFound: { path: null, title: 'Page introuvable — Aegis Manager', previewOnly: false },
}

export function pathOf(id: Exclude<RouteId, 'notFound'>): string {
  const { path } = ROUTES[id]
  if (path === null) throw new Error(`Route ${id} has no path`)
  return path
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
}

export function matchRoute(pathname: string, previewEnabled: boolean): RouteId {
  const normalized = normalize(pathname)
  for (const [id, route] of Object.entries(ROUTES) as [RouteId, RouteDefinition][]) {
    if (route.path === normalized && (previewEnabled || !route.previewOnly)) return id
  }
  return 'notFound'
}
