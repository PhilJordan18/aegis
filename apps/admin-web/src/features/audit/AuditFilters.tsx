import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/FormField'
import { Icon } from '../../ui/Icon'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { activeFilterFields, FILTER_FIELDS, type AuditFilters as Filters, type FilterField } from './auditFilters'

const NBSP = '\u00A0'

interface AuditFiltersProps {
  /** The filters of the address. */
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
 * « Filtres (n actifs) » as a disclosure, closed by default (handoff §4.4): the active filters stay visible as chips
 * that remove themselves. The form is the draft; the address holds what is applied, so a filter is bookmarkable.
 */
export function AuditFilters({ filters, unreadable, refused, onApply, onRemove, onClear }: AuditFiltersProps) {
  const { m } = useI18n()
  const t = m.audit
  const formRef = useRef<HTMLFormElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const [opened, setOpened] = useState(false)
  const [draft, setDraft] = useState<Filters>(filters)
  const [applied, setApplied] = useState(filters)
  // The draft follows the address (back button, « Tout afficher », a chip), never the other way round while typing.
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
  const errorOf = (field: FilterField): string | null => {
    if (unreadable.includes(field)) return t.dateUnreadable
    if (refused?.includes(field)) return field === 'from' || field === 'to' ? t.periodInvalid : t.fieldInvalid
    return null
  }
  const active = activeFilterFields(filters)
  const hasRefusal = refused !== null
  const open = opened || hasRefusal || unreadable.length > 0

  // The refusal is announced by the alert; focus goes to the first field it names, so the person lands on the fix.
  const refusal = refused?.join() ?? null
  useEffect(() => {
    if (refusal === null) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [refusal])

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = Object.fromEntries(FILTER_FIELDS.map((field) => [field, draft[field].trim()])) as Filters
    onApply(next)
  }

  const set = (field: FilterField) => (value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const field = (name: FilterField, type: 'date' | 'text') => (
    <TextField
      key={name}
      label={labels[name]}
      type={type}
      value={draft[name]}
      error={errorOf(name)}
      onChange={(event) => set(name)(event.target.value)}
      {...(type === 'text' ? { autoComplete: 'off', spellCheck: false } : {})}
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
        <form className="ag-au-filters" ref={formRef} aria-label={t.filtersLegend} noValidate onSubmit={submit}>
          <div className="ag-au-filters__grid">
            {field('from', 'date')}
            {field('to', 'date')}
            {field('eventType', 'text')}
            {field('subjectType', 'text')}
            {field('subjectId', 'text')}
            {field('operationId', 'text')}
            {field('actorUserId', 'text')}
          </div>
          <div className="ag-au-filters__actions">
            <Button type="submit" size="sm">
              {t.filter}
            </Button>
            <Button variant="secondary" size="sm" onClick={onClear}>
              {t.clearAll}
            </Button>
          </div>
          <p className="ag-au-filters__help">
            {t.periodHelp({ zone: LAB_TIME_ZONE })}
          </p>
        </form>
      </details>
      {active.length > 0 && (
        <div className="ag-au-chips" role="group" aria-label={t.activeFilters}>
          {active.map((name) => (
            <Button key={name} variant="secondary" size="sm" aria-label={t.removeFilter({ label: `${labels[name]} ${filters[name]}` })} onClick={() => {
                onRemove(name)
                // The chip is about to leave: focus goes to the disclosure, never to the page body (WCAG 2.4.3).
                summaryRef.current?.focus()
              }}
            >
              <span>{`${labels[name]}${NBSP}: ${filters[name]}`}</span>
              <Icon name="close" />
            </Button>
          ))}
        </div>
      )}
    </>
  )
}
