import type { ReactNode } from 'react'

export type TimelineKind = 'ok' | 'marker' | 'absent' | 'anomaly' | 'blocked'

export interface TimelineEntry {
  readonly key: string
  /** Instant as sent, for ordering; null for a step that has none. */
  readonly instant: string | null
  /** The time as shown; empty when there is none. */
  readonly time: string
  readonly label: string
  readonly kind?: TimelineKind
  readonly sub?: ReactNode
}

/**
 * Timeline of one object, or physical sequence of one operation. The marker is filled, hollow (a step that is not
 * there) or a diamond (a due date, an anomaly), and always accompanied by text: colour and shape never carry the
 * meaning alone. `ordered` sorts the dated entries by instant and keeps the undated ones last; a physical sequence
 * keeps its fixed order.
 */
export function Timeline({ entries, ordered = false, label }: { readonly entries: readonly TimelineEntry[]; readonly ordered?: boolean; readonly label?: string }) {
  const shown = ordered
    ? [...entries.filter((entry) => entry.instant !== null).sort((a, b) => Date.parse(a.instant ?? '') - Date.parse(b.instant ?? '')), ...entries.filter((entry) => entry.instant === null)]
    : entries
  return (
    <ol className="ag-tl" aria-label={label}>
      {shown.map((entry) => (
        <li key={entry.key} className={`ag-tl__item${entry.kind ? ` ag-tl__item--${entry.kind}` : ''}`}>
          <span className="ag-tl__time" aria-hidden={entry.time === '' || undefined}>
            {entry.time}
          </span>
          <span className="ag-tl__dot" aria-hidden="true" />
          <span className="ag-tl__label">
            {entry.label}
            {entry.sub && <span className="ag-tl__sub">{entry.sub}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
