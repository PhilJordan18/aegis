import { useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { SelectField, TextField } from '../../ui/FormField'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { isCalendarDay, isUuidText, STATUSES_OF_VIEW, type TransactionFilterValues, type TransactionView } from './transactionHref'

interface TransactionFiltersProps {
  readonly view: TransactionView
  /** The filters of the address. Mount one per address (a `key`), so the fields follow it. */
  readonly values: TransactionFilterValues
  readonly onApply: (filters: TransactionFilterValues) => void
}

type FieldErrors = { readonly assetId: string | null; readonly period: string | null }

/**
 * Status, equipment id and period (09 §17). The rules checked here only spare a round trip; the server stays the
 * authority. The period is read as laboratory calendar days, never the browser's zone. No sort is offered: the
 * contract defines none.
 */
export function TransactionFilters({ view, values, onApply }: TransactionFiltersProps) {
  const { m } = useI18n()
  const t = m.reservations
  const formRef = useRef<HTMLFormElement>(null)
  const [status, setStatus] = useState(values.status ?? '')
  const [assetId, setAssetId] = useState(values.assetId ?? '')
  const [from, setFrom] = useState(values.from ?? '')
  const [to, setTo] = useState(values.to ?? '')
  const [errors, setErrors] = useState<FieldErrors>({ assetId: null, period: null })

  function submit(event: FormEvent) {
    event.preventDefault()
    const asset = assetId.trim()
    const next: FieldErrors = {
      assetId: asset !== '' && !isUuidText(asset) ? t.filterAssetInvalid : null,
      period: (from !== '' && !isCalendarDay(from)) || (to !== '' && !isCalendarDay(to)) || (from !== '' && to !== '' && to < from) ? t.filterPeriodInvalid : null,
    }
    setErrors(next)
    if (next.assetId !== null || next.period !== null) {
      const field = next.assetId !== null ? 'equipement' : 'au'
      ;(formRef.current?.elements.namedItem(field) as HTMLElement | null)?.focus()
      return
    }
    onApply({ status: status === '' ? null : status, assetId: asset === '' ? null : asset.toLowerCase(), from: from === '' ? null : from, to: to === '' ? null : to })
  }

  function clear() {
    onApply({ status: null, assetId: null, from: null, to: null })
  }

  return (
    <form ref={formRef} className="ag-filters" aria-label={t.filtersLabel} noValidate onSubmit={submit}>
      <div className="ag-filters__grid">
        <SelectField name="statut" label={t.filterStatus} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t.filterAll}</option>
          {STATUSES_OF_VIEW[view].map((value) => (
            <option key={value} value={value}>
              {(t.status[view === 'reservations' ? 'reservation' : view === 'loans' ? 'loan' : 'operation'] as Record<string, string>)[value]}
            </option>
          ))}
        </SelectField>
        <TextField
          name="equipement"
          label={t.filterAsset}
          help={t.filterAssetHelp}
          error={errors.assetId}
          value={assetId}
          onChange={(event) => setAssetId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
        />
        <TextField name="du" type="date" label={t.filterFrom} value={from} onChange={(event) => setFrom(event.target.value)} />
        <TextField name="au" type="date" label={t.filterTo} error={errors.period} value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <div className="ag-filters__actions">
        <Button type="submit" variant="primary" size="sm">
          {t.filterSubmit}
        </Button>
        <Button variant="secondary" size="sm" onClick={clear}>
          {t.filterClear}
        </Button>
      </div>
      <p className="ag-filters__help">{t.filterPeriodHelp({ zone: LAB_TIME_ZONE })}</p>
    </form>
  )
}
