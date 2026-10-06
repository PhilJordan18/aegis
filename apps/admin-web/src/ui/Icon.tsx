import type { ReactNode } from 'react'

/*
 * Inline icon set authored for Aegis (handoff §10), transcribed from the
 * rendered reference. Status symbols: filled shape in currentColor, glyph in
 * --ag-glyph. Interface glyphs: 1.8 px stroke on a 24 grid. Always decorative:
 * the accessible meaning is carried by adjacent text.
 */
const glyph = { stroke: 'var(--ag-glyph)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const OCTAGON = 'M8.1 2.6h7.8l5.5 5.5v7.8l-5.5 5.5H8.1l-5.5-5.5V8.1z'
const DIAMOND = 'M12 1.6L22.4 12 12 22.4 1.6 12z'

const PATHS = {
  'status-blocked': (
    <>
      <path d={OCTAGON} fill="currentColor" />
      <path d="M7.5 12h9" {...glyph} />
    </>
  ),
  'status-error': (
    <>
      <path d={OCTAGON} fill="currentColor" />
      <path d="M12 7.4v5.4" {...glyph} />
      <circle cx="12" cy="16.5" r="1.3" fill="var(--ag-glyph)" />
    </>
  ),
  'status-info': (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M12 11v5.4" {...glyph} />
      <circle cx="12" cy="7.6" r="1.3" fill="var(--ag-glyph)" />
    </>
  ),
  'status-clock': (
    <>
      <path d={DIAMOND} fill="currentColor" />
      <path d="M12 7.6v4.6l2.8 1.8" {...glyph} />
    </>
  ),
  'status-offline': (
    <>
      <path d={DIAMOND} fill="currentColor" />
      <path d="M8.3 10.6a5.4 5.4 0 0 1 7.4 0M8 8l8 8" {...glyph} />
    </>
  ),
  'status-online': (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M7.6 10.4a6.2 6.2 0 0 1 8.8 0M9.6 12.9a3.2 3.2 0 0 1 4.8 0" {...glyph} />
      <circle cx="12" cy="15.8" r="1.2" fill="var(--ag-glyph)" />
    </>
  ),
  'status-person': (
    <>
      <rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.5" fill="currentColor" />
      <circle cx="12" cy="10" r="2.8" {...glyph} />
      <path d="M7.4 17a5.2 5.2 0 0 1 9.2 0" {...glyph} />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" {...line} />
      <path d="M12 11v5.2" {...line} />
      <circle cx="12" cy="7.9" r="1.1" fill="currentColor" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" {...line} />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" {...line} />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" {...line} />
      <rect x="13" y="4" width="7" height="7" rx="2" {...line} />
      <rect x="4" y="13" width="7" height="7" rx="2" {...line} />
      <rect x="13" y="13" width="7" height="7" rx="2" {...line} />
    </>
  ),
  box: (
    <>
      <path d="M12 3l8 4.3v9.4L12 21l-8-4.3V7.3z" {...line} />
      <path d="M4 7.3l8 4.4 8-4.4M12 11.7V21" {...line} />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" {...line} />
      <path d="M3.5 10h17M8 3v4M16 3v4" {...line} />
    </>
  ),
  locker: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" {...line} />
      <path d="M12 3.5v17M9.2 10.5v3M14.8 10.5v3" {...line} />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l8.8 15.2H3.2z" {...line} />
      <path d="M12 10v4" {...line} />
      <circle cx="12" cy="16.9" r="1" fill="currentColor" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" {...line} />
      <circle cx="5" cy="6.5" r="1.2" fill="currentColor" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="5" cy="17.5" r="1.2" fill="currentColor" />
    </>
  ),
  updown: <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" {...line} />,
  chevron: <path d="M6 9.5l6 6 6-6" {...line} />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" {...line} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...line} />
    </>
  ),
  logout: <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M14.5 8l4 4-4 4M18.5 12H9" {...line} />,
  plus: <path d="M12 5v14M5 12h14" {...line} />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" {...line} />,
  close: <path d="M6 6l12 12M18 6L6 18" {...line} />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, className, size }: { readonly name: IconName; readonly className?: string; readonly size?: number }) {
  return (
    <svg
      className={className ? `ag-icon ${className}` : 'ag-icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

/** Busy indicator: spins in 800 ms, static under reduced motion (state is carried by text). */
export function Spinner() {
  return (
    <svg className="ag-spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2.6" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
