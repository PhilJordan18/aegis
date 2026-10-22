/**
 * Typed route map. Paths are French in both languages (stable, bookmarkable addresses); ids stay English.
 * Page titles are translated: catalog `pageTitle`, keyed by route id.
 * Preview-only routes resolve to `notFound` when the preview is disabled.
 * `equipment` requires an administrator session (see RequireAdminSession).
 */
export type RouteId = 'landing' | 'signIn' | 'equipment' | 'equipmentPreview' | 'notFound'

export interface RouteDefinition {
  readonly path: string | null
  readonly previewOnly: boolean
}

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = {
  landing: { path: '/', previewOnly: false },
  signIn: { path: '/connexion', previewOnly: false },
  equipment: { path: '/equipements', previewOnly: false },
  equipmentPreview: { path: '/apercu/equipements', previewOnly: true },
  notFound: { path: null, previewOnly: false },
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
