import { abbreviate } from './labelIndex'
import './labels.css'

/**
 * An identifier shown abbreviated (« 6c0d7d3e… », contract §1.2). The visible form is hidden from assistive
 * technologies, which read the full identifier instead; no `title`, no `aria-label` on a generic element.
 */
export function IdText({ id, className }: { readonly id: string; readonly className?: string }) {
  return (
    <span className={className ? `ag-id ${className}` : 'ag-id'}>
      <span aria-hidden="true">{abbreviate(id)}</span>
      <span className="ag-sr-only">{id}</span>
    </span>
  )
}
