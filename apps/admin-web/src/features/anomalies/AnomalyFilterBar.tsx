import { useRef } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { SelectField } from '../../ui/FormField'
import { ANOMALY_SEVERITIES, ANOMALY_STATUSES, ANOMALY_TYPES } from './contract'
import type { AnomalyFilters } from './anomalyLocation'
import { AssetPicker } from '../labels/AssetPicker'
import { abbreviate, type LabelIndex } from '../labels/labelIndex'
import { FilterChips, type ActiveFilter } from '../pageTools/FilterChips'

interface AnomalyFilterBarProps {
  /** The filters of the address, the only source of truth (§3.4): every change navigates, Précédent undoes it. */
  readonly filters: AnomalyFilters
  readonly onApply: (filters: AnomalyFilters) => void
  readonly onClear: () => void
  readonly labels: Pick<LabelIndex, 'asset'>
}

const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null => ((allowed as readonly string[]).includes(value) ? (value as T) : null)

/**
 * Status, severity and type as native selects and the unit searched by code or name (§1.3), each applied as soon as
 * it is chosen, with one chip per active filter (contrat-web-manager §3.4).
 */
export function AnomalyFilterBar({ filters, labels, onApply, onClear }: AnomalyFilterBarProps) {
  const { m } = useI18n()
  const t = m.anomalies
  const statusRef = useRef<HTMLSelectElement>(null)
  const set = (patch: Partial<AnomalyFilters>) => onApply({ ...filters, ...patch })
  const assetText = (assetId: string) => {
    const label = labels.asset(assetId)
    return label.kind === 'known' ? label.code : abbreviate(assetId)
  }
  const chips: ActiveFilter[] = [
    ...(filters.status === null ? [] : [{ key: 'status', label: t.filterStatus, value: t.statusFilter[filters.status], onRemove: () => set({ status: null }) }]),
    ...(filters.severity === null ? [] : [{ key: 'severity', label: t.filterSeverity, value: t.severityFilter[filters.severity], onRemove: () => set({ severity: null }) }]),
    ...(filters.type === null ? [] : [{ key: 'type', label: t.filterType, value: t.type[filters.type], onRemove: () => set({ type: null }) }]),
    ...(filters.assetId === null ? [] : [{ key: 'asset', label: t.filterAsset, value: assetText(filters.assetId), onRemove: () => set({ assetId: null }) }]),
  ]

  return (
    <div className="ag-an-filters" role="group" aria-label={t.filtersLabel}>
      <div className="ag-an-filters__grid">
        <SelectField ref={statusRef} label={t.filterStatus} value={filters.status ?? ''} onChange={(event) => set({ status: oneOf(event.target.value, ANOMALY_STATUSES) })}>
          <option value="">{t.filterAny}</option>
          {ANOMALY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t.statusFilter[value]}
            </option>
          ))}
        </SelectField>
        <SelectField label={t.filterSeverity} value={filters.severity ?? ''} onChange={(event) => set({ severity: oneOf(event.target.value, ANOMALY_SEVERITIES) })}>
          <option value="">{t.filterAny}</option>
          {ANOMALY_SEVERITIES.slice()
            .reverse()
            .map((value) => (
              <option key={value} value={value}>
                {t.severityFilter[value]}
              </option>
            ))}
        </SelectField>
        <SelectField label={t.filterType} value={filters.type ?? ''} onChange={(event) => set({ type: oneOf(event.target.value, ANOMALY_TYPES) })}>
          <option value="">{t.filterAny}</option>
          {ANOMALY_TYPES.map((value) => (
            <option key={value} value={value}>
              {t.type[value]}
            </option>
          ))}
        </SelectField>
        <AssetPicker label={t.filterAsset} value={filters.assetId} onChange={(assetId) => set({ assetId })} labels={labels} />
      </div>
      <FilterChips filters={chips} onClear={onClear} returnFocus={() => statusRef.current?.focus()} />
    </div>
  )
}
