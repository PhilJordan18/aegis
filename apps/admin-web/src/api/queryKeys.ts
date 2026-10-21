/**
 * Every TanStack Query key of the Manager. Invalidation rules:
 * - the whole cache is cleared whenever the access token changes (sign-in,
 *   sign-out, expiry, 401), so no data outlives the session that read it;
 * - feature slices add their keys here and invalidate by prefix.
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    currentProfile: () => ['auth', 'currentProfile'] as const,
  },
} as const
