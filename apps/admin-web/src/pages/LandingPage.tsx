import { useEffect } from 'react'
import { PAGE_HEADING_ID } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { Device } from '../features/landing/Device'
import { Journey } from '../features/landing/Journey'
import { LandingHeader } from '../features/landing/LandingHeader'
import { SECTION_IDS } from '../features/landing/sections'
import { STEP_VIEWS } from '../features/landing/journeySteps'
import { SystemDiagram } from '../features/landing/SystemDiagram'
import { LanguageSwitch } from '../features/language/LanguageSwitch'
import { useI18n } from '../i18n/useI18n'
import { BrandPromise } from '../ui/BrandPromise'
import { ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { StatusChip } from '../ui/StatusChip'
import './landing.css'

/*
 * Illustrative values of the diagnostic example and the prototype status (handoff §4.5). Calendar dates
 * are shown at noon UTC so no zone can shift their day; the two times are shown in the locker's zone.
 */
const EXAMPLE_ZONE = 'America/Toronto'
const CALIBRATION_VALID_UNTIL = new Date('2026-11-30T12:00:00Z')
const CALIBRATION_EXPIRED_ON = new Date('2026-09-08T12:00:00Z')
const LAST_ANSWER = new Date('2026-11-09T19:02:00Z')
const LAST_READING = new Date('2026-11-09T18:58:00Z')
/** Date of the prototype status below; refresh it with the four lines at each delivery. */
const STATUS_DATE = new Date('2026-11-09T12:00:00Z')

const GUARANTEE_IDS = ['readiness', 'checkout', 'compartment', 'proof', 'custody'] as const
const STATUS_IDS = ['integrated', 'simulated', 'design', 'measured'] as const
/** First names only, decided by Philippe on 2026-11-09 (handoff §2.3); names are never translated. */
const STUDIO_PEOPLE = ['Philippe', 'Jimmy'] as const

function number(index: number): string {
  return String(index + 1).padStart(2, '0')
}

export function LandingPage() {
  const { m, format } = useI18n()
  const t = m.landing
  const d = t.diagnostic
  const signIn = pathOf('signIn')

  // A reload on /#parcours: the page is rendered after the browser looked for the anchor, so look again.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!(SECTION_IDS as readonly string[]).includes(id)) return
    document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div className="lp">
      <a className="lp-skip" href="#contenu">
        {m.shell.skipLink}
      </a>
      <LandingHeader />

      <main id="contenu" tabIndex={-1}>
        <section id="produit" className="lp-hero" aria-labelledby={PAGE_HEADING_ID} tabIndex={-1}>
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              <BrandPromise asHeading />
              <p className="lp-hero__system">{t.heroSystem}</p>
              <div className="lp-hero__cta">
                <ButtonLink to={signIn} variant="primary" size="lg" className="lp-hero__primary">
                  {t.signIn}
                  <Icon name="arrow" />
                </ButtonLink>
                <a className="ag-link" href="#parcours">
                  {t.seeJourney}
                </a>
              </div>
              <p className="lp-hero__mention">{t.heroMention}</p>
            </div>
            <figure className="lp-stage">
              <Device view={STEP_VIEWS.reserve} label={t.heroAlt} variant="hero" />
              <figcaption className="lp-stage__caption">
                <span>{t.stageCaption}</span>
                <span>{t.stageSource}</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="readiness" className="lp-sec" aria-labelledby="titre-readiness" tabIndex={-1}>
          <div className="lp-wrap lp-split">
            <div>
              <p className="ag-overline">{t.readiness.overline}</p>
              <h2 id="titre-readiness" className="lp-h2">
                {t.readiness.title}
              </h2>
              <p className="lp-lead">{t.readiness.lead}</p>
              <p className="lp-lead">{t.readiness.derived}</p>
            </div>
            <figure className="lp-diag" aria-labelledby="titre-diagnostic">
              <figcaption className="lp-diag__head">
                <span id="titre-diagnostic" className="ag-overline">
                  {d.heading}
                </span>
                <span className="lp-mock">{t.mockBadge}</span>
              </figcaption>
              <div className="lp-diag__row">
                <p className="lp-diag__name">
                  {d.firstName} <span className="lp-diag__code">MM-001</span>
                </p>
                <StatusChip role="ready" icon="status-ready">
                  {d.ready}
                </StatusChip>
                <p className="lp-diag__facts">{d.firstFacts({ date: format.date(CALIBRATION_VALID_UNTIL, 'UTC') })}</p>
              </div>
              <div className="lp-diag__row">
                <p className="lp-diag__name">
                  {d.secondName} <span className="lp-diag__code">MM-002</span>
                </p>
                <StatusChip role="blocked" icon="status-blocked">
                  {d.blocked}
                </StatusChip>
                <p className="lp-diag__reason">{t.calibrationExpired({ date: format.date(CALIBRATION_EXPIRED_ON, 'UTC') })}</p>
                <p className="lp-diag__facts">{d.secondFacts}</p>
              </div>
              <div className="lp-diag__row">
                <p className="lp-diag__name">
                  {d.thirdName} <span className="lp-diag__code">CT-004</span>
                </p>
                <StatusChip role="unknown" icon="status-offline">
                  {d.unknown}
                </StatusChip>
                <p className="lp-diag__reason">{d.thirdReason({ time: format.time(LAST_ANSWER, EXAMPLE_ZONE) })}</p>
                <p className="lp-diag__facts">{d.thirdFacts({ time: format.time(LAST_READING, EXAMPLE_ZONE) })}</p>
              </div>
            </figure>
          </div>
        </section>

        <section id="parcours" className="lp-sec" aria-labelledby="titre-parcours" tabIndex={-1}>
          <div className="lp-wrap">
            <Journey />
          </div>
        </section>

        <section id="systeme" className="lp-sec" aria-labelledby="titre-systeme" tabIndex={-1}>
          <div className="lp-wrap">
            <p className="ag-overline">{t.system.overline}</p>
            <h2 id="titre-systeme" className="lp-h2">
              {t.system.title}
            </h2>
            <SystemDiagram />
          </div>
        </section>

        <section id="garanties" className="lp-sec" aria-labelledby="titre-garanties" tabIndex={-1}>
          <div className="lp-wrap">
            <p className="ag-overline">{t.guaranteesOverline}</p>
            <h2 id="titre-garanties" className="lp-h2">
              {t.guaranteesTitle}
            </h2>
            <ol className="lp-ledger">
              {GUARANTEE_IDS.map((id, index) => (
                <li key={id}>
                  <span className="lp-ledger__num" aria-hidden="true">
                    {number(index)}
                  </span>
                  <h3>{t.guarantees[id].title}</h3>
                  <p>{t.guarantees[id].text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="studio" className="lp-sec lp-studio" aria-labelledby="titre-studio" tabIndex={-1}>
          <div className="lp-wrap lp-split lp-split--even">
            <div>
              <p className="ag-overline">Aegis Studio</p>
              <h2 id="titre-studio" className="lp-h2">
                {t.studio.title}
              </h2>
              <p className="lp-lead">{t.studio.text}</p>
              <ul className="lp-people" aria-label={t.studio.peopleLabel}>
                {STUDIO_PEOPLE.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="ag-overline">{t.studio.statusTitle({ date: format.date(STATUS_DATE, 'UTC') })}</h3>
              <dl className="lp-status">
                {STATUS_IDS.map((id) => (
                  <div key={id}>
                    <dt>{t.studio.status[id].label}</dt>
                    <dd>{t.studio.status[id].text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot__row">
          <span>{m.signIn.footerProduct}</span>
          <span>{t.footerTechnician}</span>
          <span>{t.footerStudio}</span>
          <LanguageSwitch compact />
        </div>
      </footer>
    </div>
  )
}
