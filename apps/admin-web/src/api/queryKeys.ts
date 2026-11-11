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
    modelList: (query: { readonly page: number; readonly size: number }) => ['catalog', 'models', 'list', query] as const,
  },
  custody: {
    all: ['custody'] as const,
    identifiers: (assetId: string) => ['custody', 'identifiers', assetId] as const,
    lockers: (query: { readonly page: number; readonly size: number }) => ['custody', 'lockers', query] as const,
  },
  transactions: {
    all: ['transactions'] as const,
    reservationList: (query: object) => ['transactions', 'reservations', 'list', query] as const,
    reservation: (id: string) => ['transactions', 'reservations', 'detail', id] as const,
    loanList: (query: object) => ['transactions', 'loans', 'list', query] as const,
    loan: (id: string) => ['transactions', 'loans', 'detail', id] as const,
    operationList: (query: object) => ['transactions', 'operations', 'list', query] as const,
    operation: (id: string) => ['transactions', 'operations', 'detail', id] as const,
  },
  lockers: {
    all: ['lockers'] as const,
    status: (lockerId: string) => ['lockers', 'status', lockerId] as const,
    schedule: (lockerId: string) => ['lockers', 'schedule', lockerId] as const,
  },
} as const
