/** Address of the Équipements page: the page is one-based, the selected unit is its id, the search is `recherche`. */
export function equipmentHref({ page, assetId, search = null }: { readonly page: number; readonly assetId: string | null; readonly search?: string | null }): string {
  const params = new URLSearchParams()
  if (search !== null) params.set('recherche', search)
  if (page > 0) params.set('page', String(page + 1))
  if (assetId !== null) params.set('exemplaire', assetId)
  const query = params.toString()
  return query === '' ? '/equipements' : `/equipements?${query}`
}

/** Models view of the same page: `?vue=modeles`, one-based page. */
export function modelsHref({ page }: { readonly page: number }): string {
  const params = new URLSearchParams({ vue: 'modeles' })
  if (page > 0) params.set('page', String(page + 1))
  return `/equipements?${params.toString()}`
}
