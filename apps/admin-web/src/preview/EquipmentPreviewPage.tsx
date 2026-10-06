import { useId } from 'react'
import { Link } from '../app/Link'
import { PageHeading } from '../app/PageHeading'
import { useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import { PREVIEW_ADMIN } from '../features/auth/previewAuthGateway'
import { useSession, useSessionStore } from '../features/auth/session'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { StatusChip } from '../ui/StatusChip'
import { PREVIEW_ONLY_TAG } from './previewOnlyTag'
import './equipment-preview.css'

/**
 * PREVIEW ONLY — static Équipements screen in the Manager shell (handoff §3.1,
 * §6; states.md §4). Illustrative fixture MM-001 / MM-002; no API call; every
 * action is inert and described by the « Aperçu visuel » bar. Loading, empty,
 * error, offline and stale states belong to CAT-01.
 */
export default function EquipmentPreviewPage() {
  const session = useSession()
  const sessionStore = useSessionStore()
  const router = useRouter()
  const profile = session.status === 'authenticated' ? session.profile : PREVIEW_ADMIN
  const ids = { note: useId(), list: useId(), dossier: useId(), saveHint: useId() }

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  return (
    <ManagerShell currentPath={pathOf('equipmentPreview')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1} data-preview-surface={PREVIEW_ONLY_TAG}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">Équipements</PageHeading>
            <nav className="ag-tabs ag-glass" aria-label="Vues des équipements">
              <Link className="ag-tabs__tab" to={pathOf('equipmentPreview')} aria-current="page">
                Exemplaires
              </Link>
              <span className="ag-tabs__tab" aria-disabled="true">
                Modèles<span className="ag-sr-only">, à venir</span>
                <span className="ag-soon" aria-hidden="true" />
              </span>
            </nav>
          </div>
          <div className="ag-page__actions">
            <p className="ag-locker">
              <StatusChip role="ready" icon="status-online">
                En ligne
              </StatusChip>
              <span>
                Casier <span className="ag-nowrap">AEGIS-DEMO-01</span> · dernier signal <span className="ag-tnum ag-nowrap">10 h 29</span>
              </span>
            </p>
            <Button variant="primary" previewInert aria-describedby={ids.note}>
              <Icon name="plus" />
              Nouvel équipement
            </Button>
          </div>
        </header>

        <p className="ag-previewbar" id={ids.note}>
          <strong>Aperçu visuel</strong>
          <span>Données illustratives, sans lien avec l'API; les actions sont inactives. La liste réelle arrive avec CAT-01.</span>
        </p>

        <div className="ag-eq">
          <section className="ag-panel ag-list" aria-labelledby={ids.list}>
            <div className="ag-list__head">
              <h2 className="ag-list__title" id={ids.list}>
                2 exemplaires
              </h2>
              <span className="ag-list__meta">Diagnostic opérationnel</span>
            </div>
            <ul className="ag-list__items">
              <li>
                <div className="ag-item">
                  <span>
                    <StatusChip role="neutral" icon="status-info">
                      Aucun empêchement détecté
                    </StatusChip>
                  </span>
                  <span className="ag-item__name">
                    Multimètre 1<span className="ag-item__code">MM-001</span>
                  </span>
                  <span className="ag-item__facts">Disponible · Présent dans A1 · En service</span>
                </div>
              </li>
              <li>
                <div className="ag-item" aria-current="true">
                  <span>
                    <StatusChip role="blocked" icon="status-blocked">
                      1 empêchement
                    </StatusChip>
                  </span>
                  <span className="ag-item__reason">
                    Calibration expirée depuis le <span className="ag-nowrap">8 sept. 2026</span>
                  </span>
                  <span className="ag-item__name">
                    Multimètre 2<span className="ag-item__code">MM-002</span>
                  </span>
                  <span className="ag-item__facts">Disponible · Présent dans A2 · En service</span>
                </div>
              </li>
            </ul>
            <p className="ag-list__foot">
              Triés par code · diagnostic évalué à <span className="ag-tnum ag-nowrap">10 h 30</span>, heure du casier
            </p>
          </section>

          <section className="ag-panel ag-dossier" aria-labelledby={ids.dossier}>
            {/* Scrolls on its own at ≥ 1024 px: focusable so the keyboard can scroll it (WCAG 2.1.1). */}
            <div className="ag-dossier__scroll" tabIndex={0} role="group" aria-labelledby={ids.dossier}>
              <p className="ag-overline">Exemplaire sélectionné</p>
              <h2 className="ag-dossier__title" id={ids.dossier}>
                Multimètre 2 · <span className="ag-tnum ag-nowrap">MM-002</span>
              </h2>
              <p className="ag-dossier__sub">
                Fluke 117 · Casier <span className="ag-nowrap">AEGIS-DEMO-01</span>, cellule A2
              </p>

              <div className="ag-diag">
                <p className="ag-overline">Diagnostic opérationnel</p>
                <div className="ag-diag__row">
                  <StatusChip role="blocked" icon="status-blocked" size="lg">
                    1 empêchement
                  </StatusChip>
                  <span className="ag-diag__reason">
                    Calibration expirée depuis le <span className="ag-nowrap">8 sept. 2026</span>
                  </span>
                </div>
                <p className="ag-diag__note">
                  Empêchements non personnels connus (disponibilité, état de service, calibration, présence), évalués à{' '}
                  <span className="ag-tnum ag-nowrap">10 h 30</span>. Une liste vide ne donne ni droit d'emprunt ni possibilité d'ouvrir le
                  casier.
                </p>
              </div>

              <div className="ag-cols">
                <div>
                  <h3 className="ag-overline ag-sec-title">
                    Faits dérivés
                    <span className="ag-readonly">
                      <Icon name="lock" />
                      lecture seule
                    </span>
                  </h3>
                  <dl className="ag-facts">
                    <div>
                      <dt>Disponibilité</dt>
                      <dd>
                        <StatusChip role="progress" icon="status-info">
                          Disponible
                        </StatusChip>
                      </dd>
                    </div>
                    <div>
                      <dt>Présence</dt>
                      <dd>Présent dans A2</dd>
                    </div>
                    <div>
                      <dt>Calibration</dt>
                      <dd className="ag-facts__blocked">
                        Expirée depuis le <span className="ag-nowrap">8 sept. 2026</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Placement</dt>
                      <dd className="ag-tnum">AEGIS-DEMO-01 · A2</dd>
                    </div>
                    <div>
                      <dt>Numéro de série</dt>
                      <dd>Non renseigné</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h3 className="ag-overline">Réglages modifiables</h3>
                  <dl className="ag-settings">
                    <div>
                      <dt>Niveau d'accès requis</dt>
                      <dd className="ag-select">
                        Standard
                        <Icon name="chevron" />
                      </dd>
                    </div>
                    <div>
                      <dt>État de service</dt>
                      <dd className="ag-select">
                        En service
                        <Icon name="chevron" />
                      </dd>
                    </div>
                    <div>
                      <dt>Calibration requise</dt>
                      <dd className="ag-switch">
                        <span className="ag-switch__track" aria-hidden="true" />
                        Oui
                      </dd>
                    </div>
                    <div>
                      <dt>Échéance de calibration</dt>
                      <dd className="ag-select ag-tnum">
                        2026-09-08
                        <Icon name="calendar" />
                      </dd>
                      <dd className="ag-help">Fuseau du casier&nbsp;: America/Toronto</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
            <div className="ag-dossier__foot">
              <Button variant="ghost" previewInert className="ag-dossier__audit" aria-describedby={ids.note}>
                Historique dans Audit
              </Button>
              <span className="ag-dossier__save">
                <span className="ag-dossier__hint" id={ids.saveHint}>
                  Aucune modification
                </span>
                <Button variant="primary" disabled aria-describedby={ids.saveHint}>
                  Enregistrer les modifications
                </Button>
              </span>
            </div>
          </section>
        </div>
      </main>
    </ManagerShell>
  )
}
