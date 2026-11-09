import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import openA1_1200 from '../../assets/landing/casier-a1-ouverte-1200.webp'
import openA1_1800 from '../../assets/landing/casier-a1-ouverte-1800.webp'
import openA1_800 from '../../assets/landing/casier-a1-ouverte-800.webp'
import closed1200 from '../../assets/landing/casier-ferme-1200.webp'
import closed1800 from '../../assets/landing/casier-ferme-1800.webp'
import closed800 from '../../assets/landing/casier-ferme-800.webp'
import light1200 from '../../assets/landing/casier-ferme-voyant-a1-1200.webp'
import light1800 from '../../assets/landing/casier-ferme-voyant-a1-1800.webp'
import light800 from '../../assets/landing/casier-ferme-voyant-a1-800.webp'
import { HubScreen } from './HubScreen'
import type { StepView } from './journeySteps'
import { homography, quadCenter, RENDER_SIZE, screenQuad } from './screenProjection'
import { useMediaQuery } from './useMediaQuery'
import './device.css'

type Render = 'closed' | 'open' | 'light'

/** Three fixed renders of Jimmy's model (docs/design/public-landing/assets/device/), WebP at three widths. */
const RENDERS: Readonly<Record<Render, string>> = {
  closed: `${closed800} 800w, ${closed1200} 1200w, ${closed1800} 1800w`,
  open: `${openA1_800} 800w, ${openA1_1200} 1200w, ${openA1_1800} 1800w`,
  light: `${light800} 800w, ${light1200} 1200w, ${light1800} 1800w`,
}
const FALLBACK_SRC: Readonly<Record<Render, string>> = { closed: closed1200, open: openA1_1200, light: light1200 }
const ALL: readonly Render[] = ['closed', 'open', 'light']

function renderOf({ doors, light }: Pick<StepView, 'doors' | 'light'>): Render {
  if (doors === 'open-a1') return 'open'
  return light === 'a1' ? 'light' : 'closed'
}

/**
 * - `hero`: the closed view only, loaded first, no magnifier;
 * - `sticky`: the journey figure; the three renders stay stacked so a step change is one cross-fade;
 * - `vignette`: one step, its render only, lazy.
 */
export type DeviceVariant = 'hero' | 'sticky' | 'vignette'

const SIZES: Readonly<Record<DeviceVariant, string>> = {
  hero: '(min-width: 1024px) 720px, (min-width: 768px) 520px, 420px',
  sticky: '560px',
  vignette: '(min-width: 768px) 420px, 100vw',
}

interface Lead {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/**
 * The Aegis locker (handoff §4.2): stacked renders, the hub screen composed in HTML and projected onto
 * the render, an optional magnifier of that screen, and a drawn silhouette when a render fails or the
 * visitor asks for reduced data. The figure is one image for assistive technology, named by `label`.
 */
export function Device({ view, label, variant }: { readonly view: StepView; readonly label: string; readonly variant: DeviceVariant }) {
  const { m } = useI18n()
  const reducedData = useMediaQuery('(prefers-reduced-data: reduce)')
  const [failed, setFailed] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [lead, setLead] = useState<Lead | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const zoom = variant !== 'hero'
  const shown = renderOf(view)
  const renders = variant === 'sticky' ? ALL : [shown]
  const broken = failed || reducedData

  const measure = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    const boxWidth = box.clientWidth
    setSize({ width: boxWidth, height: box.clientHeight })
    const card = zoomRef.current
    if (!card || boxWidth === 0) return setLead(null)
    const cardRect = card.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    if (cardRect.width === 0) return setLead(null)
    const [x2, y2] = quadCenter(screenQuad(boxWidth))
    setLead({ x1: cardRect.left - boxRect.left + cardRect.width / 2, y1: cardRect.bottom - boxRect.top, x2, y2 })
  }, [])

  useLayoutEffect(() => {
    measure()
    const box = boxRef.current
    if (!box || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [measure, broken])

  const classes = ['lp-device', `lp-device--${variant}`, broken && 'lp-device--failed'].filter(Boolean).join(' ')
  return (
    <div className={classes} data-doors={view.doors} data-light={view.light} role="img" aria-label={broken ? m.landing.deviceFallback : label}>
      {zoom && !broken && (
        <div className="lp-zoom">
          <p className="lp-zoom__label">{m.landing.journey.zoomLabel}</p>
          <div className="lp-zoom__card" ref={zoomRef}>
            <div className="lp-zoom__screen">
              <HubScreen state={view.screen} />
            </div>
          </div>
        </div>
      )}
      <div className="lp-device__box" ref={boxRef}>
        {!broken &&
          renders.map((render) => (
            <img
              key={render}
              className={`lp-device__img${render === shown ? ' is-shown' : ''}`}
              srcSet={RENDERS[render]}
              src={FALLBACK_SRC[render]}
              sizes={SIZES[variant]}
              alt=""
              width={RENDER_SIZE.width}
              height={RENDER_SIZE.height}
              decoding="async"
              loading={variant === 'hero' ? 'eager' : 'lazy'}
              fetchPriority={variant === 'hero' ? 'high' : undefined}
              onError={() => setFailed(true)}
            />
          ))}
        {!broken && size.width > 0 && (
          <div className="lp-device__screen" style={{ transform: homography(screenQuad(size.width)) }}>
            <HubScreen state={view.screen} />
          </div>
        )}
        {!broken && lead && (
          <svg className="lp-device__lead" width={size.width} height={size.height} aria-hidden="true">
            <line x1={lead.x1} y1={lead.y1} x2={lead.x2} y2={lead.y2} />
            <circle cx={lead.x2} cy={lead.y2} r="4" />
          </svg>
        )}
        {broken && (
          <div className="lp-device__fallback">
            <svg viewBox="0 0 300 300" aria-hidden="true">
              <rect x="78" y="20" width="144" height="130" rx="6" />
              <rect className="lp-device__fallback-screen" x="96" y="44" width="40" height="30" rx="2" />
              <rect x="6" y="152" width="144" height="130" rx="6" />
              <rect x="150" y="152" width="144" height="130" rx="6" />
            </svg>
            <span>{m.landing.deviceFallback}</span>
          </div>
        )}
      </div>
    </div>
  )
}
