import { useEffect, useRef, type ReactNode } from 'react'
import { signInPathFor } from '../../app/returnPath'
import { useLocation } from '../../app/router'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Brand } from '../../ui/Brand'
import { ButtonLink, Button } from '../../ui/Button'
import { Spinner } from '../../ui/Icon'
import { LanguageSwitch } from '../language/LanguageSwitch'
import { useSession, useSessionStore, type RestoreFailure } from './session'
import './sign-in.css'

/** Same frame as the sign-in and not-found pages, so the wait never flashes a different layout. */
function Frame({ children }: { readonly children: ReactNode }) {
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
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * Shown while the boot refresh has not answered (ADR-016). No redirect happens here: the server decides
 * whether the browser still holds a valid session. Announced politely; focus is left where it is.
 */
export function SessionRestoring() {
  const { m } = useI18n()
  const t = m.session
  return (
    <Frame>
      <h1 className="ag-signin__title">{t.restoringHeading}</h1>
      <p className="ag-signin__restoring" role="status" aria-live="polite">
        <span className="ag-restoring__spinner">
          <Spinner />
        </span>
        <span>{t.restoringStatus}</span>
      </p>
    </Frame>
  )
}

/**
 * The refresh could not be answered. Neither signed in nor signed out: it says so, and offers a retry and,
 * as a fallback, the sign-in page. The heading takes focus because this screen replaces the page content.
 */
export function SessionRestoreFailed({ failure, traceId }: { readonly failure: RestoreFailure; readonly traceId: string | null }) {
  const { m } = useI18n()
  const t = m.session
  const session = useSessionStore()
  const location = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <Frame>
      <h1 ref={headingRef} tabIndex={-1} className="ag-signin__title">
        {t.restoringHeading}
      </h1>
      <div className="ag-signin__body">
        {failure === 'unreachable' ? (
          <Alert kind="error" icon="status-offline" title={t.unreachableTitle}>
            <p>{t.unreachableBody}</p>
          </Alert>
        ) : failure === 'forbidden' ? (
          <Alert kind="error" icon="status-blocked" title={t.forbiddenTitle} code={traceId ?? undefined} codeLabel={traceId === null ? undefined : t.traceIdLabel}>
            <p>{t.forbiddenBody}</p>
          </Alert>
        ) : (
          <Alert
            kind="error"
            icon="status-error"
            title={t.serviceErrorTitle}
            code={traceId ?? undefined}
            codeLabel={traceId === null ? undefined : t.traceIdLabel}
          >
            <p>{traceId === null ? t.serviceErrorBodyWithoutCode : t.serviceErrorBody}</p>
          </Alert>
        )}
        <Button variant="primary" size="lg" block onClick={() => void session.restore()}>
          {t.retry}
        </Button>
        <ButtonLink to={signInPathFor(location)} variant="secondary" size="lg" block>
          {t.signInInstead}
        </ButtonLink>
      </div>
    </Frame>
  )
}

/** Renders the right screen for a status that is not `authenticated` or `anonymous`; null otherwise. */
export function SessionRestoreScreen() {
  const session = useSession()
  if (session.status === 'restoring') return <SessionRestoring />
  if (session.status === 'restoreFailed') return <SessionRestoreFailed failure={session.failure} traceId={session.traceId} />
  return null
}
