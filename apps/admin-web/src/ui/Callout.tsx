import type { ReactNode } from 'react'
import './callout.css'

export type CalloutRole = 'neutral' | 'info' | 'unknown' | 'anomaly' | 'blocked' | 'ready'

/**
 * The state block at the head of a dossier (contrat-web-manager §3.2): one row of chips, then the sentence that says
 * what they mean. Presentation only: the role is chosen by the caller from server values, never derived here.
 */
export function Callout({ role, chips, children }: { readonly role: CalloutRole; readonly chips: ReactNode; readonly children?: ReactNode }) {
  return (
    <div className={`ag-diag ag-callout ag-callout--${role}`}>
      <div className="ag-diag__row">{chips}</div>
      {children}
    </div>
  )
}

/**
 * The action zone under a dossier's title (§3.1): the existing capabilities only, primary first, a destructive one last.
 */
export function DossierActions({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="ag-dossier__actions" role="group" aria-label={label}>
      {children}
    </div>
  )
}
