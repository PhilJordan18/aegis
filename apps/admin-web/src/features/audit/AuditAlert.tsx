import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { CatalogAlert } from '../catalog/CatalogAlert'
import type { AuditFailure } from './auditFailure'

interface AuditAlertProps {
  readonly failure: AuditFailure
  /** `list`: the history could not be read. `next`: the events already loaded stay on screen and the next page failed. */
  readonly scope: 'list' | 'next'
  /** `list`: read again. `next`: load the next page again. `invalidCursor`: start again from the first page. */
  readonly onRetry: () => void
  readonly onRestart: () => void
  /** A restart is running. */
  readonly restarting: boolean
}

/**
 * One alert per failure kind. Texts come from the catalog by kind, never from the server's `title` or `detail`. A stale
 * cursor is a persistent `status`, not an error: the walk is not broken, it has to restart, and the notice stays until
 * it does so that no event ever seems to have been skipped (states.md §5).
 */
export function AuditAlert({ failure, scope, onRetry, onRestart, restarting }: AuditAlertProps) {
  const { m } = useI18n()
  const t = m.audit
  const retry = (
    <div className="ag-alert__action">
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {m.equipment.retry}
      </Button>
    </div>
  )
  switch (failure.kind) {
    case 'ended':
      return null
    case 'invalidCursor':
      return (
        <Alert kind="warning" role="status" icon="status-info" title={t.invalidCursorTitle}>
          <p>{t.invalidCursorBody}</p>
          <div className="ag-alert__action">
            <Button variant="secondary" size="sm" busy={restarting} onClick={() => !restarting && onRestart()}>
              {t.restart}
            </Button>
          </div>
        </Alert>
      )
    case 'invalidFilter':
      return (
        <Alert kind="warning" icon="status-warn" title={t.filterInvalidTitle}>
          <p>{t.filterInvalidBody}</p>
        </Alert>
      )
    case 'forbidden':
      return (
        <Alert kind="error" icon="status-error" title={t.forbiddenTitle}>
          <p>{m.equipment.forbiddenBody}</p>
        </Alert>
      )
    case 'unreachable':
      return scope === 'next' ? (
        <Alert kind="warning" icon="status-offline" title={t.nextFailedTitle}>
          <p>{t.nextFailedBody}</p>
          {retry}
        </Alert>
      ) : (
        <CatalogAlert failure={failure} onRetry={onRetry} />
      )
    case 'serviceError':
      return scope === 'next' ? (
        <Alert kind="error" icon="status-error" title={t.nextFailedTitle} code={failure.traceId ?? undefined} codeLabel={m.equipment.traceIdLabel}>
          <p>{t.nextFailedBody}</p>
          {retry}
        </Alert>
      ) : (
        <CatalogAlert failure={failure} onRetry={onRetry} />
      )
    case 'notFound':
      // Unreachable: classifyAuditFailure turns a list 404 into a traced service error.
      return <CatalogAlert failure={failure} onRetry={onRetry} />
  }
}
