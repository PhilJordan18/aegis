import { useId, useRef, type ReactNode } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { StaleNotice } from '../catalog/StaleNotice'
import type { TransactionFailure } from '../transactions/transactionFailure'
import { transactionTimes } from '../transactions/transactionPresentation'
import type { BlockRead } from './overviewModel'

/** The text next to a module's title: the server's count, a minimum, or the empty sentence. */
export interface ModuleCount {
  readonly text: string
  /** The sentence says that there is nothing: it is drawn quieter than a number. */
  readonly none?: boolean
}

interface OverviewModuleProps {
  readonly title: string
  readonly className: string
  /** The block's own read: a loading, failed or stale block never borrows the state of another. */
  readonly read: BlockRead<unknown>
  /** A request of this block is running again. */
  readonly retrying: boolean
  readonly onRetry: () => void
  /** Shown only once the block has data. */
  readonly count?: ModuleCount
  /** Shown only once the block has data; the link that opens the page holding the whole list. */
  readonly foot?: ReactNode
  readonly children?: ReactNode
  readonly primary?: boolean
}

/**
 * Frame of one block (docs/design/manager-console/handoff.md §4.1): title and count, then the block's own states. A
 * block that could not be read shows its error, never a zero; a block whose refresh failed keeps its data and says so.
 */
export function OverviewModule({ title, className, read, retrying, onRetry, count, foot, children, primary = false }: OverviewModuleProps) {
  const i18n = useI18n()
  const { m } = i18n
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ready = read.kind === 'ready'

  return (
    <section className={`ag-panel ag-ov__mod ${className}${primary ? ' ag-ov__mod--primary' : ''}`} aria-labelledby={titleId} aria-busy={read.kind === 'pending' || undefined}>
      <div className="ag-ov__head">
        <h2 className="ag-ov__title" id={titleId} tabIndex={-1} ref={titleRef}>
          {title}
        </h2>
        {ready && count !== undefined && <span className={count.none ? 'ag-ov__count ag-ov__count--none' : 'ag-ov__count'}>{count.text}</span>}
      </div>

      {read.kind === 'pending' && <ModuleSkeleton title={title} />}
      {read.kind === 'failed' && (
        <div className="ag-ov__alert">
          <ModuleAlert failure={read.failure} onRetry={onRetry} retrying={retrying} />
        </div>
      )}
      {ready && read.stale && (
        <div className="ag-ov__alert">
          <StaleNotice
            evaluatedAt={transactionTimes(i18n).readAt(read.readAt)}
            body={(time) => m.overview.staleBody({ time })}
            retrying={retrying}
            onRetry={onRetry}
            returnFocus={() => titleRef.current?.focus()}
          />
        </div>
      )}
      {ready && children}
      {ready && foot !== undefined && <p className="ag-ov__foot">{foot}</p>}
    </section>
  )
}

function ModuleSkeleton({ title }: { readonly title: string }) {
  const { m } = useI18n()
  return (
    <>
      <div className="ag-ov__body" aria-hidden="true">
        <div className="ag-skel">
          <span className="ag-skel__bar ag-skel__bar--chip" />
          <span className="ag-skel__bar ag-skel__bar--name" />
          <span className="ag-skel__bar ag-skel__bar--facts" />
        </div>
      </div>
      <p className="ag-sr-only" role="status">
        {m.overview.loadingModule({ title })}
      </p>
    </>
  )
}

interface ModuleAlertProps {
  readonly failure: TransactionFailure
  readonly onRetry?: () => void
  readonly retrying?: boolean
}

/** One alert per failure kind, with the catalog's texts: the server's `title` and `detail` are never shown. */
export function ModuleAlert({ failure, onRetry, retrying = false }: ModuleAlertProps) {
  const { m } = useI18n()
  const t = m.equipment
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
    case 'forbidden':
      return (
        <Alert kind="error" icon="status-error" title={m.overview.forbiddenTitle}>
          <p>{t.forbiddenBody}</p>
        </Alert>
      )
    // A 404 never reaches here from a list (it is classified as a service error); a locker's status 404 is no better known.
    case 'notFound':
    case 'serviceError': {
      const traceId = failure.kind === 'serviceError' ? failure.traceId : null
      return (
        <Alert kind="error" icon="status-error" title={t.serviceErrorTitle} code={traceId ?? undefined} codeLabel={t.traceIdLabel}>
          <p>{traceId ? t.serviceErrorBody : t.serviceErrorBodyWithoutCode}</p>
          {retry}
        </Alert>
      )
    }
  }
}

/** A warning inside a block that still shows data: the read is incomplete, and what the count then means. */
export function PartialNotice({ title, children, onRetry, retrying = false }: { readonly title: string; readonly children: ReactNode; readonly onRetry?: () => void; readonly retrying?: boolean }) {
  const { m } = useI18n()
  return (
    <div className="ag-ov__alert">
      <Alert kind="warning" icon="status-offline" title={title}>
        <p>{children}</p>
        {onRetry && (
          <div className="ag-alert__action">
            <Button variant="secondary" size="sm" busy={retrying} onClick={() => !retrying && onRetry()}>
              {m.equipment.retry}
            </Button>
          </div>
        )}
      </Alert>
    </div>
  )
}
