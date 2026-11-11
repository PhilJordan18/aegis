import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import type { TransactionFailure } from './transactionFailure'

interface TransactionAlertProps {
  readonly failure: TransactionFailure
  /** Offered when trying again can help (unreachable, service error). */
  readonly onRetry?: () => void
  /** Offered when the file is gone: back to the list. */
  readonly onBack?: () => void
}

/**
 * One alert per failure kind, with the texts of this screen: the server's `title` and `detail` are never shown. A
 * service error keeps its trace id; a 404 of a list reached here as a service error, never as « empty ».
 */
export function TransactionAlert({ failure, onRetry, onBack }: TransactionAlertProps) {
  const { m } = useI18n()
  const t = m.equipment
  const retry = onRetry && (
    <div className="ag-alert__action">
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t.retry}
      </Button>
    </div>
  )
  switch (failure.kind) {
    case 'ended':
      return null
    case 'unreachable':
      return (
        <Alert kind="warning" icon="status-offline" title={t.unreachableTitle}>
          <p>{t.unreachableBody}</p>
          {retry}
        </Alert>
      )
    case 'serviceError':
      return (
        <Alert kind="error" icon="status-error" title={t.serviceErrorTitle} code={failure.traceId ?? undefined} codeLabel={t.traceIdLabel}>
          <p>{failure.traceId ? t.serviceErrorBody : t.serviceErrorBodyWithoutCode}</p>
          {retry}
        </Alert>
      )
    case 'forbidden':
      return (
        <Alert kind="error" icon="status-error" title={m.reservations.forbiddenTitle}>
          <p>{t.forbiddenBody}</p>
        </Alert>
      )
    case 'notFound':
      return (
        <Alert kind="warning" icon="status-info" title={m.reservations.notFoundTitle}>
          <p>{m.reservations.notFoundBody}</p>
          {onBack && (
            <div className="ag-alert__action">
              <Button variant="secondary" size="sm" onClick={onBack}>
                {t.backToList}
              </Button>
            </div>
          )}
        </Alert>
      )
  }
}
