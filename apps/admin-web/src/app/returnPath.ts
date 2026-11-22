import { matchRoute, ROUTES, type RouteId } from './routes'

/** Query parameter of the sign-in address that names the page to come back to. */
export const RETURN_PARAMETER = 'retour'

const MAX_RETURN_LENGTH = 2048
const PROTECTED_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['overview', 'equipment', 'reservationsLoans', 'lockers', 'anomalies', 'audit'])
// Origin of a placeholder base: a candidate that resolves anywhere else is not a path of this application.
const BASE = 'https://aegis.invalid'

/**
 * Validates the page to return to after a forced sign-in. Only a same-origin path that leads to a protected
 * page of this application is accepted, so an address in a shared link cannot send the user elsewhere
 * (`//host`, `/\host`, `https://host`, control characters the URL parser would strip) nor back to /connexion.
 * Returns `path?query` without a fragment, or null.
 */
export function safeReturnPath(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > MAX_RETURN_LENGTH) return null
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null
  // A backslash or a control character (tab, newline) makes browsers read `/\host` or `/<TAB>/host` as `//host`.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return null
  let url: URL
  try {
    url = new URL(candidate, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE || !PROTECTED_ROUTES.has(matchRoute(url.pathname, false))) return null
  return `${url.pathname}${url.search}`
}

/** The validated return path carried by a sign-in `search` string, or null. */
export function returnPathFromSearch(search: string): string | null {
  return safeReturnPath(new URLSearchParams(search).get(RETURN_PARAMETER))
}

/** Sign-in address that remembers where the user was, when that is a protected page. */
export function signInPathFor(location: { readonly pathname: string; readonly search: string }): string {
  const signIn = ROUTES.signIn.path as string
  const target = safeReturnPath(`${location.pathname}${location.search}`)
  return target === null ? signIn : `${signIn}?${new URLSearchParams({ [RETURN_PARAMETER]: target }).toString()}`
}
