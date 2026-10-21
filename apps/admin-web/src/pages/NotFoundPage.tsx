import { PageHeading } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { LanguageSwitch } from '../features/language/LanguageSwitch'
import { useI18n } from '../i18n/useI18n'
import { Brand } from '../ui/Brand'
import { ButtonLink } from '../ui/Button'
import '../features/auth/sign-in.css'

/** Not covered by the handoff: the sign-in panel layout, conservatively reused. Copy provisional. */
export function NotFoundPage() {
  const { m } = useI18n()
  return (
    <div className="ag-signin">
      <div className="ag-signin__bg ag-decor" aria-hidden="true" />
      <header className="ag-signin__top ag-signin__top--end">
        <LanguageSwitch compact />
      </header>
      <main id="contenu" className="ag-signin__center" tabIndex={-1}>
        <div className="ag-signin__panel">
          <Brand />
          <PageHeading className="ag-signin__title">{m.notFound.heading}</PageHeading>
          <div className="ag-signin__body">
            <p>{m.notFound.body}</p>
            <ButtonLink to={pathOf('landing')} variant="primary" size="lg" block>
              {m.notFound.home}
            </ButtonLink>
          </div>
        </div>
      </main>
    </div>
  )
}
