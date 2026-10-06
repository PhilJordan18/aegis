import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './alert.css'

export type AlertKind = 'error' | 'warning' | 'info'

interface AlertProps {
  readonly id?: string
  readonly kind: AlertKind
  readonly icon: IconName
  readonly title: ReactNode
  readonly children?: ReactNode
  /** Machine code (traceId) in Geist Mono, selectable. */
  readonly code?: string
}

/** Errors and warnings use role="alert"; information uses role="status" (states.md §2). */
export function Alert({ id, kind, icon, title, children, code }: AlertProps) {
  return (
    <div id={id} className={`ag-alert ag-alert--${kind}`} role={kind === 'info' ? 'status' : 'alert'}>
      <Icon name={icon} />
      <div className="ag-alert__content">
        <p className="ag-alert__title">{title}</p>
        {children && <div className="ag-alert__body">{children}</div>}
        {code && <code className="ag-alert__code">{code}</code>}
      </div>
    </div>
  )
}
