import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './status-chip.css'

export type StatusRole = 'ready' | 'blocked' | 'unknown' | 'progress' | 'info' | 'neutral'

/** Symbol + shape + text; colour never carries the status alone (handoff §2.2). */
export function StatusChip({ role, icon, children, size }: { readonly role: StatusRole; readonly icon: IconName; readonly children: ReactNode; readonly size?: 'lg' }) {
  return (
    <span className={`ag-chip ag-chip--${role}${size ? ` ag-chip--${size}` : ''}`}>
      <Icon name={icon} />
      {children}
    </span>
  )
}
