import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/FormField'
import { lastDays } from './labDays'

/**
 * While a year is typed, a browser date field already reports « 0002-11-10 », then « 0020-11-10 », « 0202-11-10 »:
 * syntactically days, but not the one meant. A field applies only once its year has four significant digits.
 */
const typingYear = (day: string) => /^0\d{3}-/.test(day)

/**
 * Editing a day already there passes through other whole days (« 2026-01-10 », « 2026-12-10 », an empty field while
 * the day is retyped, « 2026-12-05 »): each would be one history entry and one request. No pause tells a finished edit
 * from a slow one (QA #246, third review), so a keyboard edit applies when the field is validated (§3.4): on leaving
 * it or on Enter. A day chosen in the calendar or by a shortcut applies at once.
 */
const editingKey = (key: string) => key.length === 1 || key === 'Backspace' || key === 'Delete' || key === 'ArrowUp' || key === 'ArrowDown'

export interface DayRange {
  readonly from: string | null
  readonly to: string | null
}

interface DateRangeProps {
  readonly value: DayRange
  /** A complete, valid range; never called while a field holds a partial or reversed date. */
  readonly onApply: (range: DayRange) => void
  readonly isDay: (value: string) => boolean
  readonly invalidText: string
  readonly help: string
  readonly fromName?: string
  readonly toName?: string
  /** An error the page already knows (an unreadable address, a server refusal), shown until the field changes. */
  readonly fromError?: string | null
  readonly toError?: string | null
}

/**
 * « Du (inclus) » and « Au (inclus) » with the laboratory zone in their help and three shortcuts (contrat-web-manager
 * §3.4). A field applies when its value is a whole valid day, never while its year is still being typed nor on each
 * key of an edit; both bounds are inclusive, as the address has
 * always read them (`au` is the last day shown).
 */
export function DateRange({ value, onApply, isDay, invalidText, help, fromName = 'du', toName = 'au', fromError = null, toError = null }: DateRangeProps) {
  const { m, locale } = useI18n()
  const t = m.pageTools
  const dateLang = locale === 'fr' ? 'fr-CA' : 'en-CA'
  const [from, setFrom] = useState(value.from ?? '')
  const [to, setTo] = useState(value.to ?? '')
  const [error, setError] = useState<{ readonly field: 'from' | 'to'; readonly text: string } | null>(null)
  const keyboard = useRef(false)
  const pending = useRef<{ from: string; to: string } | null>(null)
  // The address is the source of truth: Précédent or a removed chip resets the fields and drops a pending edit.
  const [seen, setSeen] = useState(value)
  if (seen.from !== value.from || seen.to !== value.to) {
    setSeen(value)
    setFrom(value.from ?? '')
    setTo(value.to ?? '')
    setError(null)
  }
  useEffect(() => {
    pending.current = null
  }, [value.from, value.to])

  function change(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (keyboard.current) {
      keyboard.current = false
      pending.current = { from: nextFrom, to: nextTo }
      return
    }
    pending.current = null
    apply(nextFrom, nextTo)
  }

  function flush() {
    keyboard.current = false
    const edit = pending.current
    pending.current = null
    if (edit !== null) apply(edit.from, edit.to, true)
  }

  // A key's own edit reaches `change` in the same task as its keydown. A key that changed nothing (a letter, Backspace
  // on an empty segment, Alt+ArrowDown, whose keyup goes to the opened calendar) fires no change: the flag must not
  // outlive its task, or the next calendar choice would wait for validation (QA #246, fourth review).
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') flush()
    else if (editingKey(event.key)) {
      keyboard.current = true
      setTimeout(() => {
        keyboard.current = false
      }, 0)
    }
  }

  /** `confirmed`: the field was validated (Enter or leaving it), so a year still short of four digits is an error. */
  function apply(nextFrom: string, nextTo: string, confirmed = false) {
    const shortYear = typingYear(nextFrom) || typingYear(nextTo)
    if (shortYear && !confirmed) {
      setError(null)
      return
    }
    const badFrom = nextFrom !== '' && (typingYear(nextFrom) || !isDay(nextFrom))
    const badTo = nextTo !== '' && (typingYear(nextTo) || !isDay(nextTo))
    const reversed = !badFrom && !badTo && nextFrom !== '' && nextTo !== '' && nextTo < nextFrom
    // The message sits under the field to correct: a day that is not whole under its own field, a reversed range under « Au ».
    if (badFrom || badTo) setError({ field: badFrom ? 'from' : 'to', text: t.dayIncomplete })
    else setError(reversed ? { field: 'to', text: invalidText } : null)
    if (badFrom || badTo || reversed) return
    const next = { from: nextFrom === '' ? null : nextFrom, to: nextTo === '' ? null : nextTo }
    if (next.from !== value.from || next.to !== value.to) onApply(next)
  }

  const shortcut = (days: number) => {
    const range = lastDays(days)
    change(range.from, range.to)
  }

  return (
    <>
      <TextField name={fromName} type="date" lang={dateLang} help={help} label={t.fromInclusive} error={error?.field === 'from' ? error.text : fromError} value={from} onKeyDown={keyDown} onBlur={flush} onChange={(event) => change(event.target.value, to)} />
      <TextField name={toName} type="date" lang={dateLang} help={help} label={t.toInclusive} error={error?.field === 'to' ? error.text : toError} value={to} onKeyDown={keyDown} onBlur={flush} onChange={(event) => change(from, event.target.value)} />
      {/* Below 560 px the zone help shows once under both fields; each field keeps its own for assistive technology. */}
      <p className="ag-date-help" aria-hidden="true">
        {help}
      </p>
      <div className="ag-date-shortcuts" role="group" aria-label={t.dateShortcuts}>
        <Button variant="ghost" size="sm" onClick={() => shortcut(1)}>
          {t.today}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => shortcut(7)}>
          {t.last7Days}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => shortcut(30)}>
          {t.last30Days}
        </Button>
      </div>
    </>
  )
}

