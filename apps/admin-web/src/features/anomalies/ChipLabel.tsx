import type { ChipView } from './anomalyPresentation'
import './chip-label.css'

/**
 * A chip's text. Below 560 px a chip with a short label shows it (« Élevée »), and its full label (« Gravité élevée »)
 * stays the text read by assistive technology (§8.6, third QA review): the overview and the Anomalies list agree.
 */
export function ChipLabel({ chip }: { readonly chip: ChipView }) {
  if (chip.short === undefined) return <>{chip.label}</>
  return (
    <>
      <span className="ag-chiplabel__full">{chip.label}</span>
      <span className="ag-chiplabel__short" aria-hidden="true">
        {chip.short}
      </span>
    </>
  )
}
