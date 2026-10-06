/** Query parameter selecting a preview state, e.g. `/connexion?apercu=identifiants-refuses`. */
export const PREVIEW_QUERY_PARAMETER = 'apercu'

export const SIGN_IN_PREVIEW_SCENARIOS = [
  'inactif',
  'envoi',
  'identifiants-refuses',
  'trop-de-tentatives',
  'service-injoignable',
  'erreur-service',
  'validation',
  'role-non-autorise',
  'connecte',
  'session-expiree',
  'session-invalide',
  'deconnecte',
] as const

export type SignInPreviewScenario = (typeof SIGN_IN_PREVIEW_SCENARIOS)[number]

/** Scenarios that describe the outcome of a submission (the others describe an arrival). */
export const SUBMIT_PREVIEW_SCENARIOS: ReadonlySet<SignInPreviewScenario> = new Set([
  'envoi',
  'identifiants-refuses',
  'trop-de-tentatives',
  'service-injoignable',
  'erreur-service',
  'validation',
  'role-non-autorise',
  'connecte',
])

export function isSignInPreviewScenario(value: unknown): value is SignInPreviewScenario {
  return typeof value === 'string' && (SIGN_IN_PREVIEW_SCENARIOS as readonly string[]).includes(value)
}

/** Unknown or missing values are ignored (null), never an error. */
export function parseSignInPreviewScenario(search: string): SignInPreviewScenario | null {
  const value = new URLSearchParams(search).get(PREVIEW_QUERY_PARAMETER)
  return isSignInPreviewScenario(value) ? value : null
}

export function withPreviewScenario(search: string, scenario: string | null): string {
  const params = new URLSearchParams(search)
  if (scenario === null) params.delete(PREVIEW_QUERY_PARAMETER)
  else params.set(PREVIEW_QUERY_PARAMETER, scenario)
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}
