import { useEffect, useRef, useState, type ChangeEvent } from 'react'

/** How long a keyboard choice in a filter list waits for the next arrow key before it applies. */
export const SELECT_KEYBOARD_DELAY_MS = 600

/**
 * A filter `<select>` that applies at once when chosen with the pointer, but not on every arrow key: a closed native
 * list changes its value on ArrowDown, which would push one history entry and one request per step. A keyboard choice
 * applies after a pause or when the field loses focus.
 */
export function useSettledSelect(value: string, apply: (next: string) => void) {
  const [draft, setDraft] = useState<string | null>(null)
  const keyboard = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  // The address is the source of truth: Précédent or a removed chip drops a pending choice.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(null)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [value])

  function commit(next: string) {
    window.clearTimeout(timer.current)
    timer.current = undefined
    setDraft(null)
    if (next !== value) apply(next)
  }

  return {
    value: draft ?? value,
    onKeyDown: () => {
      keyboard.current = true
    },
    onPointerDown: () => {
      keyboard.current = false
    },
    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value
      if (!keyboard.current) return commit(next)
      setDraft(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => commit(next), SELECT_KEYBOARD_DELAY_MS)
    },
    onBlur: () => {
      if (draft !== null) commit(draft)
    },
  }
}
