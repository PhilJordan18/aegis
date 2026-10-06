import { useId } from 'react'
import { Link } from '../app/Link'
import { pathOf } from '../app/routes'
import './brand.css'

/** Provisional wordmark (handoff §6, Q6): no approved logo yet. */
export function Brand() {
  const gradient = useId()
  return (
    <Link className="ag-brand" to={pathOf('landing')} aria-label="Aegis Manager, accueil">
      <svg className="ag-brand__mark" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3366FF" />
            <stop offset="1" stopColor="#4B3BD9" />
          </linearGradient>
        </defs>
        <rect className="ag-brand__frame" x="1" y="1" width="24" height="24" rx="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path className="ag-brand__cross" d="M13 1.8v22.4M1.8 13h22.4" stroke="currentColor" strokeWidth="1.2" />
        <rect x="14.6" y="14.6" width="8.6" height="8.6" rx="3" fill={`url(#${gradient})`} />
      </svg>
      <span className="ag-brand__name">Aegis</span>
      <span className="ag-brand__sub">Manager</span>
    </Link>
  )
}
