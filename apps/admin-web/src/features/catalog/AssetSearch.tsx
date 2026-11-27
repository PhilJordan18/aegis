import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { readSearchText, SEARCH_MAX_GRAPHEMES } from './searchText'

interface AssetSearchProps {
  /** The search in the address, as typed; null when there is none. */
  readonly value: string | null
  /** A valid search, already trimmed, or null to show every unit. */
  readonly onSearch: (q: string | null) => void
}

/** §3.4: the search applies 300 ms after the last keystroke, like every free-text filter. */
export const ASSET_SEARCH_DELAY_MS = 300

/**
 * Search on code and model name (09 §22.3), applied 300 ms after the last keystroke or at once with Enter
 * (contrat-web-manager §3.4). The rule is checked on the composed text: no maximum length on the field, so neither an
 * input method nor an emoji is cut short, and nothing is truncated. The server stays the authority. The field follows
 * the address (Précédent, « Effacer »), never the other way round while typing.
 */
export function AssetSearch({ value, onSearch }: AssetSearchProps) {
  const { m } = useI18n()
  const t = m.equipment
  const id = useId()
  const errorId = `${id}-error`
  const helpId = `${id}-help`
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value ?? '')
  const errorOf = (text: string) => {
    const read = readSearchText(text)
    return read.kind === 'size' ? t.searchTooLong({ max: SEARCH_MAX_GRAPHEMES }) : read.kind === 'invalid' ? t.searchInvalid : null
  }
  // An unusable value in the address filters nothing and says why.
  const [error, setError] = useState<string | null>(() => (value === null ? null : errorOf(value)))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if ((value ?? '') !== draft) {
      setDraft(value ?? '')
      setError(value === null ? null : errorOf(value))
    }
  }

  // The address value this draft would write: null for no filter, undefined while the text cannot be sent.
  const target = (text: string): string | null | undefined => {
    const read = readSearchText(text)
    return read.kind === 'valid' ? read.q : read.kind === 'empty' ? null : undefined
  }
  const pending = target(draft)
  const current = value === null ? null : target(value) === undefined ? value : target(value)
  useEffect(() => {
    if (pending === undefined || pending === current) return
    const timer = window.setTimeout(() => onSearch(pending), ASSET_SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
    // `pending` and `current` name every value the timer reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, current])

  function change(text: string) {
    setDraft(text)
    setError(errorOf(text))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending === undefined) {
      inputRef.current?.focus()
      return
    }
    if (pending !== current) onSearch(pending)
  }

  return (
    <form role="search" className="ag-search" noValidate onSubmit={submit} aria-label={t.searchLabel}>
      <div className="ag-ff">
        <label className="ag-ff__label" htmlFor={id}>
          {t.searchLabel}
        </label>
        <p className="ag-ff__help" id={helpId}>
          {t.searchHelp}
        </p>
        <div className="ag-search__row">
          <input
            ref={inputRef}
            id={id}
            type="search"
            className="ag-ff__control"
            value={draft}
            onChange={(event) => change(event.target.value)}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          <div className="ag-search__actions">
            {value !== null && (
              <Button variant="ghost" onClick={() => onSearch(null)}>
                {t.searchClear}
              </Button>
            )}
          </div>
        </div>
        <div className="ag-ff__slot">
          {error && (
            <p className="ag-ff__error" id={errorId}>
              <Icon name="status-error" />
              <span>{error}</span>
            </p>
          )}
        </div>
      </div>
    </form>
  )
}
