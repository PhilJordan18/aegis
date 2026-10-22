import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'

interface StaleNoticeProps {
  /** When the data still on screen was evaluated; null when no instant is known. */
  readonly evaluatedAt: string | null
  readonly onRetry: () => void
}

/**
 * A refresh failed but the previous data is still shown: say it is not up to date and offer to try
 * again. Shared by the list and the dossier so both say the same thing.
 */
export function StaleNotice({ evaluatedAt, onRetry }: StaleNoticeProps) {
  const { m } = useI18n()
  return (
    <Alert kind="warning" icon="status-offline" title={m.equipment.staleTitle}>
      {evaluatedAt !== null && <p>{m.equipment.staleBody({ time: evaluatedAt })}</p>}
      <div className="ag-alert__action">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {m.equipment.retry}
        </Button>
      </div>
    </Alert>
  )
}
