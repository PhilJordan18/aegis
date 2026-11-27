import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { TextField } from '../../ui/FormField'
import { Icon } from '../../ui/Icon'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { DateRange } from '../pageTools/DateRange'
import { FilterChips } from '../pageTools/FilterChips'
import { activeFilterFields, type AuditFilters as Filters, type FilterField } from './auditFilters'

/** §3.4: a free-text filter applies 300 ms after the last keystroke. */
export const AUDIT_TEXT_DELAY_MS = 300

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_FIELDS: readonly FilterField[] = ['subjectId', 'operationId', 'actorUserId']
const TEXT_FIELDS = ['eventType', 'subjectType', 'subjectId', 'operationId', 'actorUserId'] as const
type TextFieldName = (typeof TEXT_FIELDS)[number]

interface AuditFiltersProps {
  /** The filters of the address, the only source of truth: every change navigates, Précédent undoes it. */
  readonly filters: Filters
  /** Fields whose value in the address was not a day. */
  readonly unreadable: readonly FilterField[]
  /** Fields the server refused (400 VALIDATION_ERROR), shown against their field. */
  readonly refused: readonly FilterField[] | null
  readonly onApply: (filters: Filters) => void
  readonly onRemove: (field: FilterField) => void
  readonly onClear: () => void
}

/**
 * « Filtres (n actifs) » as a disclosure, closed by default (handoff §4.4), with the shared filter bar inside
 * (contrat-web-manager §3.4): dates apply on `change`, text fields 300 ms after the last keystroke, and an identifier
 * field only once it holds a UUID. The active filters stay visible as chips below, even with the disclosure closed.
 */
export function AuditFilters({ filters, unreadable, refused, onApply, onRemove, onClear }: AuditFiltersProps) {
  const { m } = useI18n()
  const t = m.audit
  const groupRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const [opened, setOpened] = useState(false)
  const [draft, setDraft] = useState<Filters>(filters)
  const [applied, setApplied] = useState(filters)
  // The draft follows the address (back button, « Effacer les filtres », a chip), never the other way round while typing.
  if (applied !== filters && JSON.stringify(applied) !== JSON.stringify(filters)) {
    setApplied(filters)
    setDraft(filters)
  }

  const labels: Record<FilterField, string> = {
    from: t.fieldFrom,
    to: t.fieldTo,
    eventType: t.fieldEventType,
    subjectType: t.fieldSubjectType,
    subjectId: t.fieldSubjectId,
    operationId: t.fieldOperationId,
    actorUserId: t.fieldActorUserId,
  }
  const notId = (field: FilterField, value: string) => ID_FIELDS.includes(field) && value.trim() !== '' && !UUID.test(value.trim())
  const errorOf = (field: FilterField): string | null => {
    if (unreadable.includes(field)) return t.dateUnreadable
    if (refused?.includes(field) && draft[field] === filters[field]) return field === 'from' || field === 'to' ? t.periodInvalid : t.fieldInvalid
    if (notId(field, draft[field])) return m.pageTools.uuidExpected
    return null
  }
  const active = activeFilterFields(filters)
  const hasRefusal = refused !== null
  const open = opened || hasRefusal || unreadable.length > 0

  // The refusal is announced by the alert; focus goes to the first field it names, so the person lands on the fix.
  const refusal = refused?.join() ?? null
  useEffect(() => {
    if (refusal === null) return
    groupRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [refusal])

  // One timer for the text fields: the last keystroke wins, and an identifier that is not a UUID sends nothing.
  const pending = TEXT_FIELDS.filter((field) => draft[field].trim() !== filters[field] && !notId(field, draft[field]))
  const pendingKey = pending.map((field) => `${field}=${draft[field].trim()}`).join('&')
  useEffect(() => {
    if (pendingKey === '') return
    const timer = window.setTimeout(() => {
      const next = { ...filters }
      for (const field of TEXT_FIELDS) if (!notId(field, draft[field])) next[field as TextFieldName] = draft[field].trim()
      onApply(next)
    }, AUDIT_TEXT_DELAY_MS)
    return () => window.clearTimeout(timer)
    // `pendingKey` names every value the timer reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])

  const text = (name: TextFieldName) => (
    <TextField
      key={name}
      label={labels[name]}
      type="text"
      value={draft[name]}
      error={errorOf(name)}
      onChange={(event) => {
        const value = event.target.value
        setDraft((current) => ({ ...current, [name]: value }))
      }}
      autoComplete="off"
      spellCheck={false}
    />
  )

  return (
    <>
      <details className="ag-au-disclosure" open={open} onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary ref={summaryRef}>
          <Icon name="chevron" />
          <span>{t.filtersLegend}</span>
          <span className="ag-au-disclosure__count">({t.filterCount({ count: active.length })})</span>
        </summary>
        <div className="ag-au-filters" ref={groupRef} role="group" aria-label={t.filtersLegend}>
          <div className="ag-au-filters__grid">
            <DateRange
              value={{ from: filters.from === '' ? null : filters.from, to: filters.to === '' ? null : filters.to }}
              onApply={(range) => onApply({ ...filters, from: range.from ?? '', to: range.to ?? '' })}
              isDay={(value) => DAY.test(value)}
              invalidText={t.periodInvalid}
              help={t.periodHelp({ zone: LAB_TIME_ZONE })}
              fromError={errorOf('from')}
              toError={errorOf('to')}
            />
            {TEXT_FIELDS.map(text)}
          </div>
        </div>
      </details>
      <FilterChips
        filters={active.map((name) => ({ key: name, label: labels[name], value: filters[name], onRemove: () => onRemove(name) }))}
        onClear={onClear}
        returnFocus={() => summaryRef.current?.focus()}
      />
    </>
  )
}
