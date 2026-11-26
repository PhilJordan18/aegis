import type { AssetLabel, CompartmentLabel, LabelIndex } from './labelIndex'

/** What a view already carries about a unit (09 §8.2 summary): it wins over the index. */
export interface KnownAsset {
  readonly assetCode: string
  readonly model: { readonly name: string }
}

export function assetLabelOf(index: Pick<LabelIndex, 'asset'>, assetId: string, known?: KnownAsset | null): AssetLabel {
  if (known) return { kind: 'known', code: known.assetCode, modelName: known.model.name, archived: false }
  return index.asset(assetId)
}

/** Plain text of a unit for a sentence or an accessible name: « Multimètre numérique · MM-002 », or null when unknown. */
export function assetText(label: AssetLabel, { withModel = true }: { readonly withModel?: boolean } = {}): string | null {
  if (label.kind !== 'known') return null
  return withModel && label.modelName ? `${label.modelName} · ${label.code}` : label.code
}

/** « Cellule A2 · AEGIS-DEMO-01 », or null when the cell is unknown. */
export function cellText(label: CompartmentLabel, cellWord: (value: { code: string }) => string): string | null {
  return label.kind === 'known' ? `${cellWord({ code: label.code })} · ${label.lockerCode}` : null
}


/** `?technique=1` opens every « Détails techniques » block of the page (support, contract §1.2). */
export const readTechnicalOpen = (search: string): boolean => new URLSearchParams(search).get('technique') === '1'
