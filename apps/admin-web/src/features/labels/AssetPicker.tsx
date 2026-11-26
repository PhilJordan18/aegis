import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { StatusChip } from '../../ui/StatusChip'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useCatalogGateway } from '../catalog/CatalogGatewayContext'
import type { AdminAssetView, AssetListQuery } from '../catalog/contract'
import type { LabelIndex } from './labelIndex'
import { AssetName } from './Labels'
import './labels.css'

export const SEARCH_MIN_LENGTH = 2
export const SEARCH_SIZE = 20
export const SEARCH_DELAY_MS = 300
const SEARCH_STALE_MS = 60_000

const searchQuery = (q: string): AssetListQuery => ({ page: 0, size: SEARCH_SIZE, sort: 'assetCode,asc', q })

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

interface AssetPickerProps {
  readonly label: string
  /** The chosen unit's identifier: the address keeps `?equipement=<uuid>` (§1.3). */
  readonly value: string | null
  readonly onChange: (assetId: string | null) => void
  readonly labels: Pick<LabelIndex, 'asset'>
}

/**
 * Units searched on the server by code or model name (contract §1.3): an ARIA 1.2 combobox with a list, 20 results,
 * 2 characters at least, 300 ms after the last keystroke; the previous request is cancelled and each text is kept 60 s.
 * The chosen unit is shown as a chip with « Retirer », which returns focus to the field.
 */
export function AssetPicker({ label, value, onChange, labels }: AssetPickerProps) {
  const { m } = useI18n()
  const t = m.labels
  const gateway = useCatalogGateway()
  const session = useSessionStore()
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [chosen, setChosen] = useState<AdminAssetView | null>(null)
  const typed = text.trim()
  const q = useDebounced(typed, SEARCH_DELAY_MS)
  const search = useQuery({
    queryKey: queryKeys.catalog.assetList(searchQuery(q)),
    queryFn: ({ signal }) => authorizedRequest(session, (token) => gateway.listAssets(token, searchQuery(q), signal)),
    enabled: q.length >= SEARCH_MIN_LENGTH,
    staleTime: SEARCH_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const settled = q === typed && !search.isFetching
  const items = typed.length >= SEARCH_MIN_LENGTH && settled && search.data !== undefined && !search.isError ? search.data.items : []
  const listId = `${id}-list`
  const helpId = `${id}-help`
  const optionId = (index: number) => `${id}-opt-${index}`

  const status =
    typed.length < SEARCH_MIN_LENGTH
      ? t.searchMin
      : !settled
        ? t.searching
        : search.isError
          ? t.searchFailed
          : items.length === 0
            ? t.searchNone({ text: typed })
            : (search.data?.totalItems ?? 0) > SEARCH_SIZE
              ? `${t.searchCount({ count: items.length })} ${t.searchRefine}`
              : t.searchCount({ count: items.length })

  function choose(unit: AdminAssetView) {
    setChosen(unit)
    setText('')
    setOpen(false)
    setActive(-1)
    onChange(unit.id)
  }

  function remove() {
    setChosen(null)
    onChange(null)
    inputRef.current?.focus()
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (items.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => (current + step + items.length) % items.length)
    } else if (event.key === 'Enter') {
      const unit = items[active]
      if (open && unit !== undefined) {
        event.preventDefault()
        choose(unit)
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        setActive(-1)
      } else if (text !== '') setText('')
    }
  }

  const expanded = open && typed.length > 0
  // The listbox is hidden without results, so the field does not claim it is expanded (ARIA 1.2 combobox).
  const listShown = expanded && items.length > 0
  const chosenLabel = value === null ? null : chosen !== null && chosen.id === value ? { kind: 'known' as const, code: chosen.assetCode, modelName: chosen.model.name, archived: chosen.archivedAt !== null } : labels.asset(value)

  return (
    <div className="ag-ff ag-picker">
      <label className="ag-ff__label" htmlFor={id}>
        {label}
      </label>
      <div className="ag-picker__field">
        <input
          ref={inputRef}
          id={id}
          className="ag-ff__control"
          role="combobox"
          aria-expanded={listShown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={helpId}
          aria-activedescendant={listShown && active >= 0 && active < items.length ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => text !== '' && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={keyDown}
        />
        <ul className="ag-picker__list" id={listId} role="listbox" aria-label={t.searchResults} hidden={!listShown}>
          {items.map((unit, index) => (
            <li
              key={unit.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'ag-picker__opt is-active' : 'ag-picker__opt'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(unit)}
            >
              <span>
                {unit.model.name} · <span className="ag-label__code">{unit.assetCode}</span>
              </span>
              {unit.archivedAt !== null && (
                <StatusChip role="neutral" icon="box">
                  {t.archived}
                </StatusChip>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="ag-ff__help ag-picker__status" id={helpId} aria-live="polite">
        {expanded || typed.length > 0 ? status : t.searchHelp}
      </p>
      {/* Outside the live region: an announcement carries text, never a control. It stays while the search is in error,
          whatever the list does, so moving focus to it (which closes the list) does not remove it (§1.3). */}
      {typed.length >= SEARCH_MIN_LENGTH && settled && search.isError && (
        <p className="ag-picker__retry">
          <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
            {t.retry}
          </Button>
        </p>
      )}
      {value !== null && chosenLabel !== null && (
        <p className="ag-picker__chosen">
          <span className="ag-picker__chip">
            <Icon name="box" />
            <AssetName assetId={value} label={chosenLabel} />
          </span>
          <Button variant="secondary" size="sm" onClick={remove} aria-label={t.removeAsset}>
            {t.remove}
          </Button>
        </p>
      )}
    </div>
  )
}
