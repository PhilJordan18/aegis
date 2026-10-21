import { PageHeading, PAGE_HEADING_ID } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { LanguageSwitch } from '../features/language/LanguageSwitch'
import { useI18n } from '../i18n/useI18n'
import { Brand } from '../ui/Brand'
import { ButtonLink } from '../ui/Button'
import { Cells } from '../ui/Cells'
import { Icon } from '../ui/Icon'
import { StatusChip } from '../ui/StatusChip'
import './landing.css'

/** Illustrative calibration expiry of the mock unit: a calendar date, shown at noon UTC so no zone can shift its day. */
const MOCK_EXPIRY = new Date('2026-09-08T12:00:00Z')
const GUARANTEE_IDS = ['readiness', 'checkout', 'compartment', 'proof', 'custody'] as const

export function LandingPage() {
  const { m, format } = useI18n()
  const t = m.landing
  const signIn = pathOf('signIn')
  return (
    <div className="ag-landing">
      <header className="ag-landing__head">
        <Brand />
        <div className="ag-landing__tools">
          <LanguageSwitch compact />
          <ButtonLink to={signIn} variant="secondary" size="sm">
            {t.signIn}
          </ButtonLink>
        </div>
      </header>

      <main id="contenu" tabIndex={-1}>
        <section className="ag-hero" aria-labelledby={PAGE_HEADING_ID}>
          <div className="ag-hero__copy">
            <p className="ag-overline">{t.overline}</p>
            <PageHeading className="ag-display">
              {t.heroLine1}
              <span className="ag-display__dot">.</span>
              <br /> {t.heroLine2}
              <span className="ag-display__dot">.</span>
              <br /> {t.heroLine3}
              <span className="ag-display__dot">.</span>
            </PageHeading>
            <p className="ag-hero__lead">{t.lead}</p>
            <div className="ag-hero__cta">
              <ButtonLink to={signIn} variant="primary" size="lg" className="ag-hero__primary">
                {t.signIn}
                <Icon name="arrow" />
              </ButtonLink>
              <a className="ag-link" href="#garanties">
                {t.seeGuarantees}
              </a>
            </div>
            <p className="ag-hero__mention">
              <Icon name="info" />
              {t.accountNote}
            </p>
          </div>

          <div className="ag-atmos">
            <Cells count={42} lit={15} litCompact={9} className="ag-atmos__cells" />
            <figure className="ag-atmos__figure">
              <figcaption>
                <span className="ag-overline">{t.mockCaption}</span>
                <span className="ag-mock">{t.mockBadge}</span>
              </figcaption>
              <div className="ag-mini">
                <StatusChip role="blocked" icon="status-blocked">
                  {t.blockers({ count: 1 })}
                </StatusChip>
                <p className="ag-mini__reason">
                  {t.calibrationExpired({ date: format.date(MOCK_EXPIRY, 'UTC') })}
                </p>
                <p className="ag-mini__name">
                  Multimètre 2<span className="ag-mini__code">MM-002</span>
                </p>
              </div>
              <div className="ag-mini">
                <StatusChip role="neutral" icon="status-info">
                  {t.noBlockers}
                </StatusChip>
                <p className="ag-mini__name">
                  Multimètre 1<span className="ag-mini__code">MM-001</span>
                </p>
              </div>
            </figure>
          </div>
        </section>

        <section id="garanties" className="ag-guarantees" aria-label={t.guaranteesLabel} tabIndex={-1}>
          <ol>
            {GUARANTEE_IDS.map((id, index) => (
              <li key={id}>
                <p className="ag-guarantees__num" aria-hidden="true">
                  0{index + 1}
                </p>
                <h2 className="ag-guarantees__title">{t.guarantees[id].title}</h2>
                <p className="ag-guarantees__text">{t.guarantees[id].text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="ag-landing__foot">
        <p>{t.footerPrototype}</p>
        <p>{t.footerTechnician}</p>
      </footer>
    </div>
  )
}
