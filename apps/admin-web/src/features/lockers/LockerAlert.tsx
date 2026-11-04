import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import type { CatalogFailure } from '../catalog/catalogFailure'

interface LockerAlertProps {
  readonly failure: CatalogFailure
  /** Offered when trying again can help (unreachable, service error). */
  readonly onRetry?: () => void
}

/** One alert per failure kind. Texts come from the catalog by kind, never from the server's `title` or `detail`. */
export function LockerAlert({ failure, onRetry }: LockerAlertProps) {
  const { m } = useI18n()
  const retry = onRetry && (
    <div className="ag-alert__action">
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {m.equipment.retry}
      </Button>
    </div>
  )
  switch (failure.kind) {
    case 'ended':
      return null
    case 'unreachable':
      return (
        <Alert kind="warning" icon="status-offline" title={m.equipment.unreachableTitle}>
          <p>{m.equipment.unreachableBody}</p>
          {retry}
        </Alert>
      )
    case 'serviceError':
      return (
        <Alert kind="error" icon="status-error" title={m.equipment.serviceErrorTitle} code={failure.traceId ?? undefined} codeLabel={m.equipment.traceIdLabel}>
          <p>{failure.traceId ? m.equipment.serviceErrorBody : m.equipment.serviceErrorBodyWithoutCode}</p>
          {retry}
        </Alert>
      )
    case 'forbidden':
      return (
        <Alert kind="error" icon="status-error" title={m.lockers.forbiddenTitle}>
          <p>{m.equipment.forbiddenBody}</p>
        </Alert>
      )
    case 'notFound':
      return (
        <Alert kind="warning" icon="status-info" title={m.lockers.notFoundTitle}>
          <p>{m.lockers.notFoundBody}</p>
        </Alert>
      )
  }
}
