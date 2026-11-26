import { useState } from 'react'
import { useLocation } from '../../app/router'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { readTechnicalOpen } from './labelText'
import './labels.css'

export interface TechnicalRow {
  readonly label: string
  readonly value: string
}

/**
 * The only place a dossier shows full identifiers (contract §1.2, §4 decision 2): a native `<details>`, closed by
 * default, placed last. Each value is selectable in one gesture and copyable; when the clipboard is refused the
 * status says so and the value stays selectable.
 */
export function TechnicalDetails({ rows, traceId }: { readonly rows: readonly TechnicalRow[]; readonly traceId?: string | null }) {
  const { m } = useI18n()
  const { search } = useLocation()
  const [status, setStatus] = useState('')
  const all = traceId ? [...rows, { label: m.labels.traceId, value: traceId }] : rows
  if (all.length === 0) return null

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus(m.labels.copied)
    } catch {
      setStatus(m.labels.copyFailed)
    }
  }

  return (
    <details className="ag-tech" open={readTechnicalOpen(search) || undefined}>
      <summary>{m.labels.technicalDetails}</summary>
      <dl className="ag-tech__list">
        {all.map((row) => (
          <div key={row.label} style={{ display: 'contents' }}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
            <dd style={{ userSelect: 'none' }}>
              <Button variant="secondary" size="sm" onClick={() => void copy(row.value)} aria-label={m.labels.copyLabel({ label: row.label })}>
                {m.labels.copy}
              </Button>
            </dd>
          </div>
        ))}
      </dl>
      <p className="ag-tech__status" role="status">
        {status}
      </p>
    </details>
  )
}
