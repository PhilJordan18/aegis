import { useId, useRef, useState, type FormEvent } from 'react'
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

/**
 * Search on code and model name (09 §22.3). The rule is checked on submit, on the composed text: no maximum length on
 * the field, so neither an input method nor an emoji is cut short, and nothing is truncated. The server stays the
 * authority. Mount one per address value (a `key`), so the field follows the address.
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

  function submit(event: FormEvent) {
    event.preventDefault()
    const read = readSearchText(draft)
    if (read.kind === 'size' || read.kind === 'invalid') {
      setError(errorOf(draft))
      inputRef.current?.focus()
      return
    }
    setError(null)
    onSearch(read.kind === 'valid' ? read.q : null)
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
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          <div className="ag-search__actions">
            <Button type="submit" variant="secondary">
              {t.searchSubmit}
            </Button>
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
