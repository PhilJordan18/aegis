import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import type { AnomalyReadFailure } from './anomalyFailure'

interface AnomalyAlertProps {
  readonly failure: AnomalyReadFailure
  /** Offered when trying again can help (unreachable, service error). */
  readonly onRetry?: () => void
  /** Offered when the anomaly is gone: back to the list. */
  readonly onBack?: () => void
  /** A retry is running: the button is busy and keeps focus. */
  readonly retrying?: boolean
}

/** One alert per read failure kind. Texts come from the catalog by kind, never from the server's `title` or `detail`. */
export function AnomalyAlert({ failure, onRetry, onBack, retrying = false }: AnomalyAlertProps) {
  const { m } = useI18n()
  const t = m.anomalies
  const retry = onRetry && (
    <div className="ag-alert__action">
      <Button variant="secondary" size="sm" busy={retrying} onClick={() => !retrying && onRetry()}>
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
        <Alert kind="error" icon="status-error" title={t.forbiddenTitle}>
          <p>{t.forbiddenBody}</p>
        </Alert>
      )
    case 'notFound':
      return (
        <Alert kind="warning" icon="status-info" title={t.notFoundTitle}>
          <p>{t.notFoundBody}</p>
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
