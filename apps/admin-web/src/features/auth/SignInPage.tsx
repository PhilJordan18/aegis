import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link } from '../../app/Link'
import { useRouter } from '../../app/router'
import { pathOf } from '../../app/routes'
import { usePreviewControls, useSignInPreviewAutoSubmit } from '../../preview/PreviewContext'
import { Alert } from '../../ui/Alert'
import { Brand } from '../../ui/Brand'
import { Button } from '../../ui/Button'
import { Cells } from '../../ui/Cells'
import { Icon } from '../../ui/Icon'
import { useAuthGateway } from './AuthGatewayContext'
import type { UserRole } from './contract'
import { useSession, useSessionStore } from './session'
import { signInCopy } from './signInCopy'
import { signInStateFromResult, type SignInArrivalReason, type SignInState } from './signInOutcome'
import { errorsFromViolations, SIGN_IN_TIMEOUT_MS, validateSignIn, type FieldErrors } from './signInValidation'
import './sign-in.css'

const { approved, proposed } = signInCopy

function formatRemaining(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

type FocusTarget = 'email' | 'password' | 'heading'

interface RoleScreen {
  readonly role: UserRole | null
  readonly email: string
}

interface SignInPageProps {
  /** Where an administrator goes after a confirmed sign-in. */
  readonly afterSignInPath: string
}

export function SignInPage({ afterSignInPath }: SignInPageProps) {
  const gateway = useAuthGateway()
  const sessionStore = useSessionStore()
  const session = useSession()
  const router = useRouter()
  const preview = usePreviewControls()
  const autoSubmitVersion = useSignInPreviewAutoSubmit()

  const [initialArrival] = useState<SignInArrivalReason | null>(() => (session.status === 'anonymous' ? session.arrivalReason : null))
  const [email, setEmail] = useState(() => (session.status === 'anonymous' ? (session.email ?? '') : ''))
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [outcome, setOutcome] = useState<SignInState>({ kind: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [unknownViolation, setUnknownViolation] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [lockDeadline, setLockDeadline] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [statusMessage, setStatusMessage] = useState('')
  const [roleScreen, setRoleScreen] = useState<RoleScreen | null>(null)

  const inFlight = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const pendingFocus = useRef<FocusTarget | null>(
    initialArrival === 'sessionExpired' || initialArrival === 'sessionInvalid' ? 'password' : 'email',
  )
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const ids = {
    alert: useId(),
    email: useId(),
    emailError: useId(),
    password: useId(),
    passwordError: useId(),
    hint: useId(),
  }

  useEffect(() => {
    mounted.current = true
    // This page decides its own focus target; drop the router's heading request.
    router.consumeFocusRequest()
    return () => {
      mounted.current = false
      // Deferred so a StrictMode remount keeps its request; a real unmount aborts it.
      setTimeout(() => {
        if (!mounted.current) inFlight.current?.abort()
      }, 0)
    }
  }, [router])

  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    ;({ email: emailRef, password: passwordRef, heading: headingRef })[target].current?.focus()
  })

  useEffect(() => {
    if (lockDeadline === null) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= lockDeadline) {
        // Back to idle: the stale « Réessayez dans N secondes. » alert goes away (review R4).
        setLockDeadline(null)
        setOutcome({ kind: 'idle' })
        setStatusMessage(proposed.rateLimitedReady)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [lockDeadline])

  const locked = lockDeadline !== null
  const submitting = outcome.kind === 'submitting'

  async function submit(values: { email: string; password: string }, { fill = false } = {}) {
    if (inFlight.current || locked) return
    if (fill) {
      setEmail(values.email)
      setPassword(values.password)
    }
    setAttempted(true)
    setRevealed(false)
    setUnknownViolation(false)
    const errors = validateSignIn(values.email, values.password)
    if (errors.email || errors.password) {
      setFieldErrors(errors)
      setOutcome({ kind: 'idle' })
      pendingFocus.current = errors.email ? 'email' : 'password'
      return
    }
    setFieldErrors({})
    sessionStore.acknowledgeArrival()

    const controller = new AbortController()
    inFlight.current = controller
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, SIGN_IN_TIMEOUT_MS)
    setOutcome({ kind: 'submitting' })
    setStatusMessage(proposed.submittingStatus)

    try {
      const result = await gateway.signIn({ email: values.email.trim(), password: values.password }, controller.signal)
      if (!mounted.current) return
      const next: SignInState = timedOut ? { kind: 'unreachable' } : signInStateFromResult(result)
      setStatusMessage('')
      switch (next.kind) {
        case 'signedIn':
          sessionStore.start({ accessToken: next.accessToken, expiresAt: next.expiresAt, profile: next.profile })
          router.navigate(afterSignInPath)
          return
        case 'unauthorizedRole':
          // U6: the token only ever existed in the discarded `result`; nothing is stored or requested.
          setRoleScreen({ role: next.role, email: values.email.trim() })
          setEmail('')
          setPassword('')
          pendingFocus.current = 'heading'
          break
        case 'invalidCredentials':
          setPassword('')
          pendingFocus.current = 'password'
          break
        case 'validation': {
          const mapped = errorsFromViolations(next.violations, values)
          setFieldErrors(mapped.errors)
          setUnknownViolation(mapped.unknown)
          pendingFocus.current = mapped.errors.email || !mapped.errors.password ? 'email' : 'password'
          break
        }
        case 'rateLimited':
          if (next.retryAfterSeconds !== null && next.retryAfterSeconds > 0) {
            const current = Date.now()
            setNow(current)
            setLockDeadline(current + next.retryAfterSeconds * 1000)
          }
          break
        default:
          break
      }
      setOutcome(next)
    } catch {
      if (mounted.current) {
        setStatusMessage('')
        setOutcome({ kind: 'unreachable' })
      }
    } finally {
      clearTimeout(timeout)
      if (inFlight.current === controller) inFlight.current = null
    }
  }

  const submitRef = useRef(submit)
  useLayoutEffect(() => {
    submitRef.current = submit
  })

  // Preview switcher only: submit fictitious values once, through the real flow.
  useEffect(() => {
    const values = preview?.takeAutoSubmit()
    if (values) void submitRef.current(values, { fill: true })
  }, [preview, autoSubmitVersion])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit({ email, password })
  }

  function revalidate(field: 'email' | 'password', nextEmail: string, nextPassword: string) {
    if (!attempted || !fieldErrors[field]) return
    const errors = validateSignIn(nextEmail, nextPassword)
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  function handleEmail(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value)
    revalidate('email', event.target.value, password)
  }

  function handlePassword(event: ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value)
    revalidate('password', email, event.target.value)
  }

  function toggleReveal() {
    setStatusMessage(revealed ? proposed.concealedStatus : proposed.revealedStatus)
    setRevealed(!revealed)
  }

  function retryWithAnotherAccount() {
    setRoleScreen(null)
    setOutcome({ kind: 'idle' })
    setFieldErrors({})
    setAttempted(false)
    pendingFocus.current = 'email'
  }

  const arrival = outcome.kind === 'idle' && session.status === 'anonymous' ? session.arrivalReason : null
  const alert = renderAlert({ id: ids.alert, outcome, arrival, unknownViolation })
  const alertDescribesPassword =
    outcome.kind === 'invalidCredentials' || arrival === 'sessionExpired' || arrival === 'sessionInvalid'
  const remaining = lockDeadline === null ? 0 : Math.max(0, Math.ceil((lockDeadline - now) / 1000))

  return (
    <div className="ag-signin">
      <div className="ag-signin__bg ag-decor" aria-hidden="true" />
      <Cells count={98} lit={38} litCompact={null} className="ag-cells--page ag-signin__cells" />
      <header className="ag-signin__top">
        <Link className="ag-signin__home" to={pathOf('landing')}>
          <Icon name="back" />
          {proposed.home}
        </Link>
      </header>

      <main id="contenu" className="ag-signin__center">
        <div className="ag-signin__panel">
          <Brand />
          <h1 ref={headingRef} className="ag-signin__title" tabIndex={-1}>
            {roleScreen ? proposed.roleHeading : approved.heading}
          </h1>

          {roleScreen ? (
            <div className="ag-signin__body">
              <Alert kind="warning" icon="status-person" title={roleScreen.role === 'TECHNICIAN' ? approved.technicianAccount : proposed.roleUnknownTitle}>
                <p>{proposed.roleBody}</p>
              </Alert>
              <p className="ag-signin__who">
                {proposed.roleAccountUsed} <span className="ag-tnum">{roleScreen.email}</span>
              </p>
              <Button variant="primary" size="lg" block onClick={retryWithAnotherAccount}>
                {proposed.roleRetry}
              </Button>
            </div>
          ) : (
            <form className="ag-signin__body" method="post" noValidate onSubmit={handleSubmit} aria-busy={submitting || undefined} data-state={outcome.kind}>
              {alert}
              <Field
                id={ids.email}
                errorId={ids.emailError}
                label={approved.emailLabel}
                error={fieldErrors.email}
                readOnly={submitting}
              >
                <input
                  ref={emailRef}
                  id={ids.email}
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={handleEmail}
                  readOnly={submitting}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={fieldErrors.email ? ids.emailError : undefined}
                />
              </Field>
              <Field
                id={ids.password}
                errorId={ids.passwordError}
                label={approved.passwordLabel}
                error={fieldErrors.password}
                readOnly={submitting}
              >
                <input
                  ref={passwordRef}
                  id={ids.password}
                  name="password"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={handlePassword}
                  readOnly={submitting}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={
                    [alertDescribesPassword ? ids.alert : null, fieldErrors.password ? ids.passwordError : null].filter(Boolean).join(' ') ||
                    undefined
                  }
                />
                <button
                  type="button"
                  className="ag-field__reveal"
                  aria-controls={ids.password}
                  aria-label={revealed ? proposed.concealLabel : proposed.revealLabel}
                  onClick={toggleReveal}
                >
                  {revealed ? proposed.conceal : proposed.reveal}
                </button>
              </Field>

              <div className="ag-signin__submit">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  busy={submitting}
                  inert={locked}
                  aria-describedby={locked ? `${ids.alert} ${ids.hint}` : undefined}
                >
                  {submitting ? proposed.submitting : approved.submit}
                </Button>
                {locked && (
                  <p id={ids.hint} className="ag-signin__hint ag-tnum">
                    {proposed.rateLimitedHint(formatRemaining(remaining))}
                  </p>
                )}
              </div>
              <p className="ag-signin__mention">
                <Icon name="info" />
                {approved.accountNote}
              </p>
            </form>
          )}
          <p className="ag-sr-only" role="status">
            {statusMessage}
          </p>
        </div>
      </main>

      <footer className="ag-signin__foot">
        <p>{proposed.technicianFooter}</p>
      </footer>
    </div>
  )
}

function Field({
  id,
  errorId,
  label,
  error,
  readOnly,
  children,
}: {
  readonly id: string
  readonly errorId: string
  readonly label: string
  readonly error: string | undefined
  readonly readOnly: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="ag-field">
      <label className="ag-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="ag-field__control" data-invalid={error ? '' : undefined} data-readonly={readOnly ? '' : undefined}>
        {children}
      </div>
      {error && (
        <p className="ag-field__error" id={errorId}>
          <Icon name="status-error" />
          {error}
        </p>
      )}
    </div>
  )
}

function renderAlert({
  id,
  outcome,
  arrival,
  unknownViolation,
}: {
  id: string
  outcome: SignInState
  arrival: SignInArrivalReason | null
  unknownViolation: boolean
}): ReactNode {
  switch (outcome.kind) {
    case 'invalidCredentials':
      return (
        <Alert id={id} kind="error" icon="status-error" title={approved.invalidCredentialsTitle}>
          <p>{proposed.invalidCredentialsBody}</p>
        </Alert>
      )
    case 'rateLimited':
      return (
        <Alert id={id} kind="warning" icon="status-clock" title={approved.rateLimitedTitle}>
          <p className="ag-tnum">
            {outcome.retryAfterSeconds !== null && outcome.retryAfterSeconds > 0
              ? proposed.rateLimitedBody(outcome.retryAfterSeconds)
              : approved.rateLimitedFallback}
          </p>
        </Alert>
      )
    case 'unreachable':
      return (
        <Alert id={id} kind="warning" icon="status-offline" title={approved.unreachableTitle}>
          <p>{proposed.unreachableBody}</p>
        </Alert>
      )
    case 'serviceError':
      return (
        <Alert id={id} kind="error" icon="status-error" title={proposed.serviceErrorTitle} code={outcome.traceId ?? undefined}>
          <p>{outcome.traceId ? proposed.serviceErrorBody : proposed.serviceErrorBodyWithoutCode}</p>
        </Alert>
      )
    case 'validation':
      return unknownViolation ? <Alert id={id} kind="error" icon="status-error" title={proposed.validationUnknown} /> : null
    case 'idle':
      switch (arrival) {
        case 'sessionExpired':
          return (
            <Alert id={id} kind="info" icon="status-clock" title={approved.sessionExpiredTitle}>
              <p>{proposed.sessionExpiredBody}</p>
            </Alert>
          )
        case 'sessionInvalid':
          return (
            <Alert id={id} kind="info" icon="status-info" title={proposed.sessionInvalidTitle}>
              <p>{proposed.sessionInvalidBody}</p>
            </Alert>
          )
        case 'signedOut':
          return <Alert id={id} kind="info" icon="status-info" title={proposed.signedOutTitle} />
        case null:
          return null
      }
      return null
    case 'submitting':
    case 'unauthorizedRole':
    case 'signedIn':
      return null
  }
}
