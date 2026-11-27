import { useRef } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'

export interface ActiveFilter {
  readonly key: string
  /** « Statut » */
  readonly label: string
  /** « Actives » */
  readonly value: string
  /** The whole chip text when « label : value » reads badly (« Du 10 nov. »). */
  readonly text?: string
  readonly onRemove: () => void
}

/**
 * One chip per active filter and « Effacer les filtres » (contrat-web-manager §3.4). Each chip removes its filter; the
 * focus then goes to the group's clear button or, once nothing is left, to `returnFocus`, never to the page body.
 */
export function FilterChips({ filters, onClear, returnFocus }: { readonly filters: readonly ActiveFilter[]; readonly onClear: () => void; readonly returnFocus: () => void }) {
  const { m } = useI18n()
  const t = m.pageTools
  const groupRef = useRef<HTMLDivElement>(null)
  if (filters.length === 0) return null
  const after = () => {
    if (filters.length > 1) groupRef.current?.querySelector<HTMLElement>('.ag-chips__clear')?.focus()
    else returnFocus()
  }
  return (
    <div className="ag-chips" role="group" aria-label={t.activeFilters} ref={groupRef}>
      {filters.map((filter) => (
        <span key={filter.key} className="ag-chips__chip">
          <span>{filter.text ?? t.filterChip({ label: filter.label, value: filter.value })}</span>
          <button
            type="button"
            className="ag-chips__remove"
            aria-label={t.removeFilter({ label: filter.label })}
            onClick={() => {
              filter.onRemove()
              after()
            }}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="ag-chips__clear"
        onClick={() => {
          onClear()
          returnFocus()
        }}
      >
        {t.clearFilters}
      </Button>
    </div>
  )
}
