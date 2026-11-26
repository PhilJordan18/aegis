import { useRef, useState, type FormEvent } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { SelectField, TextField } from '../../ui/FormField'
import { AssetPicker } from '../labels/AssetPicker'
import { IdText } from '../labels/IdText'
import type { LockerLabel } from '../labels/labelIndex'
import { useLabelIndex } from '../labels/useLabelIndex'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { isCalendarDay, NO_FILTERS, STATUSES_OF_VIEW, transactionHref, type TransactionFilterValues, type TransactionView } from './transactionHref'

interface TransactionFiltersProps {
  readonly view: TransactionView
  /** The filters of the address. Mount one per address (a `key`), so the fields follow it. */
  readonly values: TransactionFilterValues
  readonly onApply: (filters: TransactionFilterValues) => void
}

type FieldErrors = { readonly period: string | null }

/**
 * Status, equipment (searched by code or name, §1.3) and period (09 §17). The rules checked here only spare a round trip; the server stays the
 * authority. The period is read as laboratory calendar days, never the browser's zone. No sort is offered: the
 * contract defines none.
 */
export function TransactionFilters({ view, values, onApply }: TransactionFiltersProps) {
  const { m, locale } = useI18n()
  // §1.7: the date field follows the interface language; the help says the format where the browser does not.
  const dateLang = locale === 'fr' ? 'fr-CA' : 'en-CA'
  const t = m.reservations
  const formRef = useRef<HTMLFormElement>(null)
  const [status, setStatus] = useState(values.status ?? '')
  const [assetId, setAssetId] = useState<string | null>(values.assetId)
  const labels = useLabelIndex()
  const [from, setFrom] = useState(values.from ?? '')
  const [to, setTo] = useState(values.to ?? '')
  const [errors, setErrors] = useState<FieldErrors>({ period: null })

  function submit(event: FormEvent) {
    event.preventDefault()
    const next: FieldErrors = {
      period: (from !== '' && !isCalendarDay(from)) || (to !== '' && !isCalendarDay(to)) || (from !== '' && to !== '' && to < from) ? t.filterPeriodInvalid : null,
    }
    setErrors(next)
    if (next.period !== null) {
      ;(formRef.current?.elements.namedItem('au') as HTMLElement | null)?.focus()
      return
    }
    onApply({ status: status === '' ? null : status, assetId, lockerId: values.lockerId, from: from === '' ? null : from, to: to === '' ? null : to })
  }

  function clear() {
    onApply(NO_FILTERS)
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
        <AssetPicker label={t.filterAsset} value={assetId} onChange={setAssetId} labels={labels} />
        <TextField name="du" type="date" lang={dateLang} help={t.dateHelp} label={t.filterFrom} value={from} onChange={(event) => setFrom(event.target.value)} />
        <TextField name="au" type="date" lang={dateLang} help={t.dateHelp} label={t.filterTo} error={errors.period} value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <div className="ag-filters__actions">
        <Button type="submit" variant="primary" size="sm">
          {t.filterSubmit}
        </Button>
        <Button variant="secondary" size="sm" onClick={clear}>
          {t.filterClear}
        </Button>
      </div>
      {view === 'operations' && values.lockerId !== null && (
        <p className="ag-filters__help" data-testid="locker-filter">
          {t.filterLocker} <LockerFilterName lockerId={values.lockerId} label={labels.locker(values.lockerId)} />{' '}
          <Link className="ag-link" to={transactionHref({ view, filters: { ...values, lockerId: null } })}>
            {t.filterLockerRemove}
          </Link>
        </p>
      )}
      <p className="ag-filters__help">
        {t.filterPeriodHelp({ zone: LAB_TIME_ZONE })}
      </p>
    </form>
  )
}

/** §1.8 criterion 1: the filtered locker reads by its code, or by its abbreviated identifier until the index knows it. */
function LockerFilterName({ lockerId, label }: { readonly lockerId: string; readonly label: LockerLabel }) {
  return label.kind === 'known' ? <span className="ag-label__code">{label.code}</span> : <IdText id={lockerId} />
}
