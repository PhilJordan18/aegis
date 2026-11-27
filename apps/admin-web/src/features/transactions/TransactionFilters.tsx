import { useRef } from 'react'
import { Link } from '../../app/Link'
import { FORMAT_LOCALE } from '../../i18n/locale'
import { useI18n } from '../../i18n/useI18n'
import { SelectField } from '../../ui/FormField'
import { AssetPicker } from '../labels/AssetPicker'
import { IdText } from '../labels/IdText'
import type { LockerLabel } from '../labels/labelIndex'
import { useLabelIndex } from '../labels/useLabelIndex'
import { abbreviate } from '../labels/labelIndex'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { DateRange } from '../pageTools/DateRange'
import { FilterChips, type ActiveFilter } from '../pageTools/FilterChips'
import { useSettledSelect } from '../pageTools/useSettledSelect'
import { shortDay } from '../pageTools/labDays'
import { isCalendarDay, NO_FILTERS, STATUSES_OF_VIEW, transactionHref, type TransactionFilterValues, type TransactionView } from './transactionHref'

interface TransactionFiltersProps {
  readonly view: TransactionView
  /** The filters of the address, the only source of truth (§3.4): every change navigates, Précédent undoes it. */
  readonly values: TransactionFilterValues
  readonly onApply: (filters: TransactionFilterValues) => void
}

/**
 * Status, equipment (searched by code or name, §1.3) and period (09 §17), applied as soon as they change
 * (contrat-web-manager §3.4). The rules checked here only spare a round trip; the server stays the authority. The
 * period is read as laboratory calendar days, never the browser's zone. No sort is offered: the contract defines none.
 */
export function TransactionFilters({ view, values, onApply }: TransactionFiltersProps) {
  const { m, locale } = useI18n()
  const t = m.reservations
  const labels = useLabelIndex()
  const statusRef = useRef<HTMLSelectElement>(null)
  const statusText = (value: string) => (t.status[view === 'reservations' ? 'reservation' : view === 'loans' ? 'loan' : 'operation'] as Record<string, string>)[value] ?? value
  const set = (patch: Partial<TransactionFilterValues>) => onApply({ ...values, ...patch })

  const assetText = (assetId: string) => {
    const label = labels.asset(assetId)
    return label.kind === 'known' ? label.code : abbreviate(assetId)
  }
  const day = (value: string) => shortDay(value, FORMAT_LOCALE[locale])
  const chips: ActiveFilter[] = [
    ...(values.status === null ? [] : [{ key: 'status', label: t.filterStatus, value: statusText(values.status), onRemove: () => set({ status: null }) }]),
    ...(values.assetId === null ? [] : [{ key: 'asset', label: t.filterAsset, value: assetText(values.assetId), onRemove: () => set({ assetId: null }) }]),
    ...(values.from === null ? [] : [{ key: 'from', label: m.pageTools.fromInclusive, value: day(values.from), text: m.pageTools.fromDay({ day: day(values.from) }), onRemove: () => set({ from: null }) }]),
    ...(values.to === null ? [] : [{ key: 'to', label: m.pageTools.toInclusive, value: day(values.to), text: m.pageTools.toDay({ day: day(values.to) }), onRemove: () => set({ to: null }) }]),
  ]

  const status = useSettledSelect(values.status ?? '', (next) => set({ status: next === '' ? null : next }))

  return (
    <div className="ag-filters" role="group" aria-label={t.filtersLabel}>
      <div className="ag-filters__grid">
        <SelectField ref={statusRef} name="statut" label={t.filterStatus} {...status}>
          <option value="">{t.filterAll}</option>
          {STATUSES_OF_VIEW[view].map((value) => (
            <option key={value} value={value}>
              {statusText(value)}
            </option>
          ))}
        </SelectField>
        <AssetPicker label={t.filterAsset} value={values.assetId} onChange={(assetId) => set({ assetId })} labels={labels} />
        <DateRange
          value={{ from: values.from, to: values.to }}
          onApply={(range) => set(range)}
          isDay={isCalendarDay}
          invalidText={t.filterPeriodInvalid}
          help={t.filterPeriodHelp({ zone: LAB_TIME_ZONE })}
        />
      </div>
      <FilterChips filters={chips} onClear={() => onApply(NO_FILTERS)} returnFocus={() => statusRef.current?.focus()} />
      {view === 'operations' && values.lockerId !== null && (
        <p className="ag-filters__help" data-testid="locker-filter">
          {t.filterLocker} <LockerFilterName lockerId={values.lockerId} label={labels.locker(values.lockerId)} />{' '}
          <Link className="ag-link" to={transactionHref({ view, filters: { ...values, lockerId: null } })}>
            {t.filterLockerRemove}
          </Link>
        </p>
      )}
    </div>
  )
}

/** §1.8 criterion 1: the filtered locker reads by its code, or by its abbreviated identifier until the index knows it. */
function LockerFilterName({ lockerId, label }: { readonly lockerId: string; readonly label: LockerLabel }) {
  return label.kind === 'known' ? <span className="ag-label__code">{label.code}</span> : <IdText id={lockerId} />
}
