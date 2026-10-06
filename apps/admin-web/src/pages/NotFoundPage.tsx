import { PageHeading } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { Brand } from '../ui/Brand'
import { ButtonLink } from '../ui/Button'
import '../features/auth/sign-in.css'

/** Not covered by the handoff: the sign-in panel layout, conservatively reused. Copy provisional. */
export function NotFoundPage() {
  return (
    <div className="ag-signin">
      <div className="ag-signin__bg ag-decor" aria-hidden="true" />
      <main id="contenu" className="ag-signin__center" tabIndex={-1}>
        <div className="ag-signin__panel">
          <Brand />
          <PageHeading className="ag-signin__title">Page introuvable</PageHeading>
          <div className="ag-signin__body">
            <p>Cette adresse ne correspond à aucune page d'Aegis Manager.</p>
            <ButtonLink to={pathOf('landing')} variant="primary" size="lg" block>
              Retour à l'accueil
            </ButtonLink>
          </div>
        </div>
      </main>
    </div>
  )
}
