import { useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { SelectField } from '../../ui/FormField'
import { ANOMALY_SEVERITIES, ANOMALY_STATUSES, ANOMALY_TYPES, type AnomalySeverity, type AnomalyStatus, type AnomalyType } from './contract'
import type { AnomalyFilters } from './anomalyLocation'

interface AnomalyFilterBarProps {
  /** The filters of the address. The page remounts the bar when they change, so the fields start from them. */
  readonly filters: AnomalyFilters
  readonly onApply: (filters: AnomalyFilters) => void
  readonly onClear: () => void
}

const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null => ((allowed as readonly string[]).includes(value) ? (value as T) : null)

/** Status, severity and type as three native selects and one explicit « Filtrer »: no request per keystroke or choice. */
export function AnomalyFilterBar({ filters, onApply, onClear }: AnomalyFilterBarProps) {
  const { m } = useI18n()
  const t = m.anomalies
  const [status, setStatus] = useState<AnomalyStatus | ''>(filters.status ?? '')
  const [severity, setSeverity] = useState<AnomalySeverity | ''>(filters.severity ?? '')
  const [type, setType] = useState<AnomalyType | ''>(filters.type ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    onApply({ status: oneOf(status, ANOMALY_STATUSES), severity: oneOf(severity, ANOMALY_SEVERITIES), type: oneOf(type, ANOMALY_TYPES) })
  }

  return (
    <form className="ag-an-filters" aria-label={t.filtersLabel} onSubmit={submit}>
      <div className="ag-an-filters__grid">
        <SelectField label={t.filterStatus} value={status} onChange={(event) => setStatus(event.target.value as AnomalyStatus | '')}>
          <option value="">{t.filterAny}</option>
          {ANOMALY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t.statusFilter[value]}
            </option>
          ))}
        </SelectField>
        <SelectField label={t.filterSeverity} value={severity} onChange={(event) => setSeverity(event.target.value as AnomalySeverity | '')}>
          <option value="">{t.filterAny}</option>
          {ANOMALY_SEVERITIES.slice()
            .reverse()
            .map((value) => (
              <option key={value} value={value}>
                {t.severityFilter[value]}
              </option>
            ))}
        </SelectField>
        <SelectField label={t.filterType} value={type} onChange={(event) => setType(event.target.value as AnomalyType | '')}>
          <option value="">{t.filterAny}</option>
          {ANOMALY_TYPES.map((value) => (
            <option key={value} value={value}>
              {t.type[value]}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="ag-an-filters__actions">
        <Button type="submit" size="sm">
          {t.filterApply}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClear}>
          {t.filterClear}
        </Button>
      </div>
    </form>
  )
}
