import { useCallback, useId, useState } from 'react'

const storageKey = (page: string) => `aegis.pageHelp.${page}`

function readOpen(page: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(page)) === '1'
  } catch {
    return false
  }
}

export interface PageHelpState {
  readonly open: boolean
  readonly toggle: () => void
  readonly panelId: string
}

/** The page help (contract §1.4): closed by default, its state kept per page for the browser tab (an interface preference). */
export function usePageHelp(page: string): PageHelpState {
  const panelId = useId()
  const [open, setOpen] = useState(() => readOpen(page))
  const toggle = useCallback(() => {
    setOpen((was) => {
      try {
        window.sessionStorage.setItem(storageKey(page), was ? '0' : '1')
      } catch {
        // Storage refused: the panel still opens, the preference is simply not kept.
      }
      return !was
    })
  }, [page])
  return { open, toggle, panelId }
}
