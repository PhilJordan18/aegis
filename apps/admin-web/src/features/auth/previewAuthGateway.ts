import { PREVIEW_ONLY_TAG } from '../../preview/previewOnlyTag'
import type { SignInPreviewScenario } from '../../preview/previewScenarios'
import type { AuthGateway, GatewayResult } from './authGateway'
import type { LoginResponse, ProblemResponse, UserProfile } from './contract'

/**
 * PREVIEW ONLY — design review and deterministic captures. It never checks
 * the submitted credentials, never contacts the API and never returns a real
 * token: the result is chosen by the selected preview scenario. It is loaded
 * only when `__AEGIS_PREVIEW__` is true (see main.tsx).
 */
export const PREVIEW_FAKE_ACCESS_TOKEN = `${PREVIEW_ONLY_TAG}:not-a-token`

const PREVIEW_TRACE_ID = '00000000-0000-4000-8000-000000000000'
const PREVIEW_TIMESTAMP = '2026-09-30T14:30:00Z'
const PREVIEW_EXPIRES_AT = '2026-09-30T15:30:00Z'

export const PREVIEW_ADMIN: UserProfile = {
  id: '00000000-0000-4000-8000-00000000a001',
  displayName: 'Administrateur Démo',
  email: 'admin@aegis.demo',
  role: 'ADMIN',
  maximumAccessLevel: 'RESTRICTED',
}

const PREVIEW_TECHNICIAN: UserProfile = {
  id: '00000000-0000-4000-8000-00000000b001',
  displayName: 'Technicien Démo',
  email: 'technician@aegis.demo',
  role: 'TECHNICIAN',
  maximumAccessLevel: 'STANDARD',
}

function login(user: UserProfile): GatewayResult<LoginResponse> {
  return {
    kind: 'ok',
    requestId: PREVIEW_TRACE_ID,
    value: { accessToken: PREVIEW_FAKE_ACCESS_TOKEN, tokenType: 'Bearer', expiresIn: 3600, expiresAt: PREVIEW_EXPIRES_AT, user },
  }
}

function problem(status: number, code: string, title: string, detail: string, extra: Partial<ProblemResponse> = {}): ProblemResponse {
  return {
    type: `https://aegis.local/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    detail,
    instance: '/api/v1/auth/login',
    traceId: PREVIEW_TRACE_ID,
    timestamp: PREVIEW_TIMESTAMP,
    ...extra,
  }
}

function failure(status: number, body: ProblemResponse | null, retryAfter: string | null = null): GatewayResult<LoginResponse> {
  return { kind: 'httpProblem', status, problem: body, retryAfter, requestId: PREVIEW_TRACE_ID }
}

/** Resolves only when the signal aborts, so the submitting state can be inspected and captured. */
function pendingUntilAborted(signal: AbortSignal | undefined): Promise<GatewayResult<LoginResponse>> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ kind: 'aborted' })
    signal?.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true })
  })
}

export function previewSignInResult(scenario: SignInPreviewScenario | null): GatewayResult<LoginResponse> | 'pending' {
  switch (scenario) {
    case 'envoi':
      return 'pending'
    case 'identifiants-refuses':
      return failure(401, problem(401, 'AUTH_INVALID_CREDENTIALS', 'Connexion refusée', 'Adresse courriel ou mot de passe incorrect.'))
    case 'trop-de-tentatives':
      return failure(429, problem(429, 'RATE_LIMITED', 'Trop de requêtes', 'Trop de tentatives de connexion.'), '55')
    case 'service-injoignable':
      return { kind: 'network', reason: 'offline' }
    case 'erreur-service':
      return failure(500, problem(500, 'INTERNAL_ERROR', 'Erreur inattendue', 'Une erreur inattendue est survenue.'))
    case 'validation':
      return failure(
        400,
        problem(400, 'VALIDATION_ERROR', 'Requête invalide', 'Un ou plusieurs champs sont invalides.', {
          // Field code is illustrative: 09 §7 does not enumerate violation codes.
          violations: [{ field: 'email', code: 'INVALID_FORMAT', message: "L'adresse courriel n'est pas valide." }],
        }),
      )
    case 'role-non-autorise':
      return login(PREVIEW_TECHNICIAN)
    case null:
    case 'inactif':
    case 'connecte':
    case 'session-expiree':
    case 'session-invalide':
    case 'deconnecte':
      return login(PREVIEW_ADMIN)
  }
}

export function createPreviewAuthGateway(getScenario: () => SignInPreviewScenario | null): AuthGateway {
  return {
    async signIn(_request, signal) {
      const result = previewSignInResult(getScenario())
      return result === 'pending' ? pendingUntilAborted(signal) : result
    },
    async currentProfile() {
      return { kind: 'ok', value: PREVIEW_ADMIN, requestId: PREVIEW_TRACE_ID }
    },
  }
}
