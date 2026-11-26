import { useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/FormField'
import { lastDays } from './labDays'

/**
 * While a year is typed, a browser date field already reports « 0002-11-10 », then « 0020-11-10 », « 0202-11-10 »:
 * syntactically days, but not the one meant. A field applies only once its year has four significant digits.
 */
const typingYear = (day: string) => /^0\d{3}-/.test(day)

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
 * §3.4). A field applies when its value is a whole valid day (`change`), never while its year is still being typed; both bounds are inclusive, as the address has
 * always read them (`au` is the last day shown).
 */
export function DateRange({ value, onApply, isDay, invalidText, help, fromName = 'du', toName = 'au', fromError = null, toError = null }: DateRangeProps) {
  const { m, locale } = useI18n()
  const t = m.pageTools
  const dateLang = locale === 'fr' ? 'fr-CA' : 'en-CA'
  const [from, setFrom] = useState(value.from ?? '')
  const [to, setTo] = useState(value.to ?? '')
  const [error, setError] = useState<string | null>(null)
  // The address is the source of truth: Précédent or a removed chip resets the fields.
  const [seen, setSeen] = useState(value)
  if (seen.from !== value.from || seen.to !== value.to) {
    setSeen(value)
    setFrom(value.from ?? '')
    setTo(value.to ?? '')
    setError(null)
  }

  function change(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (typingYear(nextFrom) || typingYear(nextTo)) {
      setError(null)
      return
    }
    const invalid = (nextFrom !== '' && !isDay(nextFrom)) || (nextTo !== '' && !isDay(nextTo)) || (nextFrom !== '' && nextTo !== '' && nextTo < nextFrom)
    setError(invalid ? invalidText : null)
    if (invalid) return
    const next = { from: nextFrom === '' ? null : nextFrom, to: nextTo === '' ? null : nextTo }
    if (next.from !== value.from || next.to !== value.to) onApply(next)
  }

  const shortcut = (days: number) => {
    const range = lastDays(days)
    change(range.from, range.to)
  }

  return (
    <>
      <TextField name={fromName} type="date" lang={dateLang} help={help} label={t.fromInclusive} error={fromError} value={from} onChange={(event) => change(event.target.value, to)} />
      <TextField name={toName} type="date" lang={dateLang} help={help} label={t.toInclusive} error={error ?? toError} value={to} onChange={(event) => change(from, event.target.value)} />
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

