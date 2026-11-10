import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Device } from './Device'
import { STEP_IDS, STEP_VIEWS, stepNumber } from './journeySteps'
import { useMediaQuery } from './useMediaQuery'

/**
 * The six-step journey (handoff §4.4). From 1024 px without reduced motion, the locker figure sticks
 * beside the steps and follows the step being read: one opacity change per step, observed, never
 * driven, so scrolling stays the visitor's. Narrower, or with reduced motion, each step carries its
 * own still vignette; same component, same renders, same information.
 */
export function Journey() {
  const { m } = useI18n()
  const t = m.landing.journey
  const wide = useMediaQuery('(min-width: 1024px)')
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const follows = wide && !reduced
  const [active, setActive] = useState(0)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (!follows || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = stepRefs.current.indexOf(entry.target as HTMLLIElement)
          if (index >= 0) setActive(index)
        }
      },
      { threshold: 0.6, rootMargin: '-10% 0px -10% 0px' },
    )
    for (const step of stepRefs.current) if (step) observer.observe(step)
    return () => observer.disconnect()
  }, [follows])

  const activeId = STEP_IDS[active] ?? 'reserve'
  const caption = (index: number, state: string) => t.stepCaption({ number: stepNumber(index), state })

  return (
    <div className={`lp-split lp-journey${follows ? ' lp-journey--follows' : ''}`}>
      <div>
        <p className="ag-overline">{t.overline}</p>
        <h2 id="titre-parcours" className="lp-h2">
          {t.title}
        </h2>
        <p className="lp-lead">{t.lead}</p>
        <ol className="lp-steps">
          {STEP_IDS.map((id, index) => {
            const step = t.steps[id]
            const view = STEP_VIEWS[id]
            const current = follows && index === active
            return (
              <li
                key={id}
                ref={(node) => {
                  stepRefs.current[index] = node
                }}
                className={`lp-step${current ? ' is-active' : ''}`}
                aria-current={current ? 'step' : undefined}
              >
                <span className="lp-step__num" aria-hidden="true">
                  {stepNumber(index)}
                </span>
                <h3 className="lp-step__title">
                  {step.title}
                  <span className={`lp-tag${view.live ? ' lp-tag--live' : ''}`}>{view.live ? t.tagLive : t.tagPlanned}</span>
                </h3>
                <p className="lp-step__text">{step.text}</p>
                {!follows && (
                  <figure className="lp-vignette">
                    <Device view={view} label={step.alt} variant="vignette" />
                    <figcaption>{caption(index, step.state)}</figcaption>
                  </figure>
                )}
              </li>
            )
          })}
        </ol>
      </div>
      {follows && (
        <figure className="lp-sticky">
          <Device view={STEP_VIEWS[activeId]} label={t.steps[activeId].alt} variant="sticky" />
          <figcaption>
            <span className="lp-rail__dots" aria-hidden="true">
              {STEP_IDS.map((id, index) => (
                <i key={id} className={index <= active ? 'is-on' : undefined} />
              ))}
            </span>
            <p className="lp-rail" aria-live="polite">
              {caption(active, t.steps[activeId].state)}
            </p>
          </figcaption>
        </figure>
      )}
    </div>
  )
}
