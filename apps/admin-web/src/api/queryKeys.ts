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
  catalog: {
    all: ['catalog'] as const,
    assetList: (query: { readonly page: number; readonly size: number; readonly sort: string }) => ['catalog', 'assets', 'list', query] as const,
    asset: (assetId: string) => ['catalog', 'assets', 'detail', assetId] as const,
  },
} as const
