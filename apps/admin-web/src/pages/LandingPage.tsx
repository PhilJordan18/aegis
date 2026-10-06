import { PageHeading, PAGE_HEADING_ID } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { Brand } from '../ui/Brand'
import { ButtonLink } from '../ui/Button'
import { Cells } from '../ui/Cells'
import { Icon } from '../ui/Icon'
import { StatusChip } from '../ui/StatusChip'
import './landing.css'

/** Copy: handoff §7, all [P] except the account note [A]. No data, no request. */
const GUARANTEES: readonly [title: string, text: string][] = [
  ['Disponibilité réelle', "Chaque équipement indique s'il peut servir; sinon, la raison précise : calibration expirée, maintenance, absence de sa cellule."],
  ['Retrait conforme', "Le serveur refuse un retrait non autorisé ou non conforme; l'interface l'explique, elle ne le décide pas."],
  ['Bonne cellule', "Seule la cellule attendue s'ouvre, après une autorisation valide. Une réservation ou un code affiché n'ouvre rien."],
  ['Preuve physique', 'Retrait et retour sont confirmés par des observations cohérentes du casier, jamais par un simple clic.'],
  ['Chaîne de possession', "Chaque action et chaque observation restent consultables dans l'audit, sans effacement."],
]

export function LandingPage() {
  const signIn = pathOf('signIn')
  return (
    <div className="ag-landing">
      <header className="ag-landing__head">
        <Brand />
        <ButtonLink to={signIn} variant="secondary" size="sm">
          Se connecter
        </ButtonLink>
      </header>

      <main id="contenu" tabIndex={-1}>
        <section className="ag-hero" aria-labelledby={PAGE_HEADING_ID}>
          <div className="ag-hero__copy">
            <p className="ag-overline">Aegis Manager · console d'administration</p>
            <PageHeading className="ag-display">
              Autorisé<span className="ag-display__dot">.</span>
              <br /> Observé<span className="ag-display__dot">.</span>
              <br /> Tracé<span className="ag-display__dot">.</span>
            </PageHeading>
            <p className="ag-hero__lead">
              Aegis montre si chaque équipement critique peut servir, n'ouvre que la cellule attendue et conserve une chaîne de possession
              complète, du retrait au retour.
            </p>
            <div className="ag-hero__cta">
              <ButtonLink to={signIn} variant="primary" size="lg" className="ag-hero__primary">
                Se connecter
                <Icon name="arrow" />
              </ButtonLink>
              <a className="ag-link" href="#garanties">
                Voir les cinq garanties
              </a>
            </div>
            <p className="ag-hero__mention">
              <Icon name="info" />
              Compte fourni par votre administrateur.
            </p>
          </div>

          <div className="ag-atmos">
            <Cells count={42} lit={15} litCompact={9} className="ag-atmos__cells" />
            <figure className="ag-atmos__figure">
              <figcaption>
                <span className="ag-overline">Diagnostic d'un exemplaire</span>
                <span className="ag-mock">Exemple illustratif</span>
              </figcaption>
              <div className="ag-mini">
                <StatusChip role="blocked" icon="status-blocked">
                  1 empêchement
                </StatusChip>
                <p className="ag-mini__reason">
                  Calibration expirée depuis le <span className="ag-nowrap">8 sept. 2026</span>
                </p>
                <p className="ag-mini__name">
                  Multimètre 2<span className="ag-mini__code">MM-002</span>
                </p>
              </div>
              <div className="ag-mini">
                <StatusChip role="neutral" icon="status-info">
                  Aucun empêchement détecté
                </StatusChip>
                <p className="ag-mini__name">
                  Multimètre 1<span className="ag-mini__code">MM-001</span>
                </p>
              </div>
            </figure>
          </div>
        </section>

        <section id="garanties" className="ag-guarantees" aria-label="Cinq garanties du P0" tabIndex={-1}>
          <ol>
            {GUARANTEES.map(([title, text], index) => (
              <li key={title}>
                <p className="ag-guarantees__num" aria-hidden="true">
                  0{index + 1}
                </p>
                <h2 className="ag-guarantees__title">{title}</h2>
                <p className="ag-guarantees__text">{text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="ag-landing__foot">
        <p>Prototype académique en cours de validation en laboratoire, conçu pour les équipes de maintenance et d'inspection.</p>
        <p>Technicien&nbsp;? Utilisez l'application Aegis sur iPhone.</p>
      </footer>
    </div>
  )
}
