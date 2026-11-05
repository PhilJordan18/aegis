/** Address of the Équipements page: the page is one-based, the selected unit is its id. */
export function equipmentHref({ page, assetId }: { readonly page: number; readonly assetId: string | null }): string {
  const params = new URLSearchParams()
  if (page > 0) params.set('page', String(page + 1))
  if (assetId !== null) params.set('exemplaire', assetId)
  const query = params.toString()
  return query === '' ? '/equipements' : `/equipements?${query}`
}
