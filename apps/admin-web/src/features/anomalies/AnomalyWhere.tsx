import { Fragment, type ReactNode } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { IdText } from '../labels/IdText'
import type { LabelIndex } from '../labels/labelIndex'
import { AssetName } from '../labels/Labels'
import type { AnomalyView } from './contract'

/**
 * The row form of `whereLine`: « Cellule A2 · Multimètre numérique · MM-002 ». A part still loading or not in the
 * label index shows its abbreviated identifier, as §1.1 requires, never a label guessed from current placement.
 */
export function AnomalyWhere({ anomaly, labels }: { readonly anomaly: AnomalyView; readonly labels: Pick<LabelIndex, 'asset' | 'compartment'> }) {
  const { m } = useI18n()
  const parts: ReactNode[] = []
  if (anomaly.compartmentId === null) parts.push(m.anomalies.noCell)
  else {
    const cell = labels.compartment(anomaly.compartmentId)
    parts.push(
      cell.kind === 'known' ? (
        m.labels.cell({ code: cell.code })
      ) : (
        <span className={cell.kind === 'pending' ? 'ag-label ag-label--pending' : 'ag-label'}>
          {m.anomalies.fCell} <IdText id={anomaly.compartmentId} />
        </span>
      ),
    )
  }
  if (anomaly.assetId !== null) parts.push(<AssetName assetId={anomaly.assetId} label={labels.asset(anomaly.assetId)} />)
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && ' · '}
          {part}
        </Fragment>
      ))}
    </>
  )
}
