import { useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'

interface StaleNoticeProps {
  /** When the data still on screen was evaluated; null when no instant is known. */
  readonly evaluatedAt: string | null
  /** A refresh is running: the button is busy and keeps focus. */
  readonly retrying: boolean
  readonly onRetry: () => void
  /** Called when a successful refresh removes the notice while its button has focus. */
  readonly returnFocus: () => void
}

/**
 * A refresh failed but the previous data is still shown: say it is not up to date and offer to try
 * again. Shared by the list and the dossier so both say the same thing.
 */
export function StaleNotice({ evaluatedAt, retrying, onRetry, returnFocus }: StaleNoticeProps) {
  const { m } = useI18n()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(returnFocus)
  const [previousRetrying, setPreviousRetrying] = useState(retrying)
  const [failedAgain, setFailedAgain] = useState(false)

  // The alert does not speak twice: a refresh that ends while the notice is still here failed again.
  if (retrying !== previousRetrying) {
    setPreviousRetrying(retrying)
    setFailedAgain(!retrying)
  }

  useLayoutEffect(() => {
    returnFocusRef.current = returnFocus
  })

  // Runs before the button leaves the page, so focus can move instead of falling back to the body (WCAG 2.4.3).
  useLayoutEffect(() => {
    const button = buttonRef.current
    return () => {
      if (button !== null && button === document.activeElement) returnFocusRef.current()
    }
  }, [])

  return (
    <>
      <Alert kind="warning" icon="status-offline" title={m.equipment.staleTitle}>
        {evaluatedAt !== null && <p>{m.equipment.staleBody({ time: evaluatedAt })}</p>}
        <div className="ag-alert__action">
          <Button ref={buttonRef} variant="secondary" size="sm" busy={retrying} onClick={() => !retrying && onRetry()}>
            {m.equipment.retry}
          </Button>
        </div>
      </Alert>
      <p className="ag-sr-only" role="status">
        {failedAgain ? m.equipment.staleTitle : ''}
      </p>
    </>
  )
}
