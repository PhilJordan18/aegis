import type { AccessLevel, LoginResponse, UserProfile, UserRole } from './contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * 09 §4.4 profile. An unknown `role` or `maximumAccessLevel` is kept as is:
 * callers treat it as unavailable (09 §3), never as an administrator.
 */
export function parseUserProfile(body: unknown): UserProfile | null {
  if (!isRecord(body)) return null
  const { id, displayName, email, role, maximumAccessLevel } = body
  if (!isText(id) || !isText(displayName) || !isText(email) || !isText(role) || !isText(maximumAccessLevel)) return null
  return { id, displayName, email, role: role as UserRole, maximumAccessLevel: maximumAccessLevel as AccessLevel }
}

/** 09 §10.2 response 200. */
export function parseLoginResponse(body: unknown): LoginResponse | null {
  if (!isRecord(body)) return null
  const { accessToken, tokenType, expiresIn, expiresAt, user } = body
  if (!isText(accessToken) || tokenType !== 'Bearer' || !isText(expiresAt)) return null
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  const profile = parseUserProfile(user)
  if (profile === null) return null
  return { accessToken, tokenType, expiresIn, expiresAt, user: profile }
}
