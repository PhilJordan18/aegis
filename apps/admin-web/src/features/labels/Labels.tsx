import { useI18n } from '../../i18n/useI18n'
import { StatusChip } from '../../ui/StatusChip'
import { IdText } from './IdText'
import type { AssetLabel, CompartmentLabel, LabelIndex } from './labelIndex'
import './labels.css'

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

/**
 * A unit, label first (§1.2): « Multimètre numérique · MM-002 », the code alone when only the code is known. While the
 * index loads, the abbreviated identifier in a reserved skeleton; when the unit is not in the index, the abbreviated
 * identifier with « Identifiant seulement ».
 */
export function AssetName({ assetId, label, withModel = true }: { readonly assetId: string; readonly label: AssetLabel; readonly withModel?: boolean }) {
  const { m } = useI18n()
  if (label.kind === 'pending')
    return (
      <span className="ag-label ag-label--pending" aria-busy="true">
        <IdText id={assetId} />
      </span>
    )
  if (label.kind === 'unknown')
    return (
      <span className="ag-label">
        <IdText id={assetId} />
        <StatusChip role="neutral" icon="info">
          {m.labels.idOnly}
        </StatusChip>
      </span>
    )
  return (
    <span className="ag-label">
      <span>
        {withModel && label.modelName ? `${label.modelName} · ` : ''}
        <span className="ag-label__code">{label.code}</span>
      </span>
      {label.archived ? (
        <StatusChip role="neutral" icon="box">
          {m.labels.archived}
        </StatusChip>
      ) : null}
    </span>
  )
}

/** « Cellule A2 · AEGIS-DEMO-01 », or null when the cell is unknown. */
export function cellText(label: CompartmentLabel, cellWord: (code: string) => string): string | null {
  return label.kind === 'known' ? `${cellWord(label.code)} · ${label.lockerCode}` : null
}

export function CellName({ compartmentId, label }: { readonly compartmentId: string; readonly label: CompartmentLabel }) {
  const { m } = useI18n()
  if (label.kind === 'known') return <span className="ag-label">{cellText(label, m.labels.cell)}</span>
  if (label.kind === 'pending')
    return (
      <span className="ag-label ag-label--pending" aria-busy="true">
        <IdText id={compartmentId} />
      </span>
    )
  return (
    <span className="ag-label">
      <IdText id={compartmentId} />
      <StatusChip role="neutral" icon="info">
        {m.labels.idOnly}
      </StatusChip>
    </span>
  )
}
