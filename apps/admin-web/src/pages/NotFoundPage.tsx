import { PageHeading } from '../app/PageHeading'
import { pathOf } from '../app/routes'
import { LanguageSwitch } from '../features/language/LanguageSwitch'
import { useI18n } from '../i18n/useI18n'
import { Brand } from '../ui/Brand'
import { ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'
import '../features/auth/sign-in.css'

/** Not covered by the handoff: the sign-in card frame, conservatively reused. Copy provisional. */
export function NotFoundPage() {
  const { m } = useI18n()
  return (
    <div className="ag-signin">
      <header className="ag-signin__header">
        <Brand />
        <div className="ag-signin__tools">
          <LanguageSwitch compact />
        </div>
      </header>
      <div className="ag-signin__content ag-signin__content--single">
        <main id="contenu" className="ag-signin__card" tabIndex={-1}>
          <PageHeading className="ag-signin__title">{m.notFound.heading}</PageHeading>
          <div className="ag-signin__body">
            <p>{m.notFound.body}</p>
            <ButtonLink to={pathOf('landing')} variant="primary" size="lg" block>
              {m.notFound.home}
              <Icon name="arrow" />
            </ButtonLink>
          </div>
        </main>
      </div>
    </div>
  )
}
