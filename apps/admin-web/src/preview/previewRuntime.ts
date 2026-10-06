import type { Router } from '../app/router'
import { pathOf } from '../app/routes'
import type { AuthGateway } from '../features/auth/authGateway'
import { createPreviewAuthGateway, PREVIEW_ADMIN } from '../features/auth/previewAuthGateway'
import type { SessionStore } from '../features/auth/session'
import { PREVIEW_ONLY_TAG } from './previewOnlyTag'
import type { PreviewControls } from './PreviewContext'
import {
  SIGN_IN_PREVIEW_SCENARIOS,
  SUBMIT_PREVIEW_SCENARIOS,
  isSignInPreviewScenario,
  parseSignInPreviewScenario,
  withPreviewScenario,
  type SignInPreviewScenario,
} from './previewScenarios'

export interface PreviewRuntime {
  readonly gateway: AuthGateway
  readonly controls: PreviewControls
  dispose(): void
}

/** Obviously fictitious values; the preview gateway ignores them. */
export const PREVIEW_FORM_VALUES = { email: 'revue@apercu.test', password: 'valeur-fictive-apercu' } as const

/**
 * PREVIEW ONLY. The URL is the single source of truth for the selected
 * scenario, so a capture or a shared link reproduces the same state.
 * Arrival scenarios drive the real session store, as a 401 or a sign-out would.
 */
export function installPreview({ router, session }: { router: Router; session: SessionStore }): PreviewRuntime {
  document.documentElement.dataset.preview = PREVIEW_ONLY_TAG

  const getScenario = (): SignInPreviewScenario | null => parseSignInPreviewScenario(router.getSnapshot().search)
  const listeners = new Set<() => void>()
  let autoSubmit: { email: string; password: string } | null = null
  let autoSubmitVersion = 0

  let applied: SignInPreviewScenario | null | undefined
  function syncArrival() {
    const scenario = getScenario()
    if (scenario === applied) return
    applied = scenario
    if (scenario === 'session-expiree') session.end('sessionExpired', PREVIEW_ADMIN.email)
    else if (scenario === 'session-invalide') session.end('sessionInvalid', PREVIEW_ADMIN.email)
    else if (scenario === 'deconnecte') session.signOut()
    else if (session.getSnapshot().status === 'anonymous') session.acknowledgeArrival()
  }
  syncArrival()
  const unsubscribe = router.subscribe(syncArrival)

  const notify = () => listeners.forEach((listener) => listener())

  const controls: PreviewControls = {
    signInScenarios: SIGN_IN_PREVIEW_SCENARIOS,
    getSignInScenario: getScenario,
    setSignInScenario(scenario) {
      if (scenario !== null && !isSignInPreviewScenario(scenario)) return
      const { pathname, search } = router.getSnapshot()
      router.navigate(`${pathname}${withPreviewScenario(search, scenario)}`, { replace: true })
    },
    showSignInScenario(scenario) {
      if (!isSignInPreviewScenario(scenario)) return
      const onSignIn = router.getSnapshot().pathname === pathOf('signIn')
      autoSubmit = SUBMIT_PREVIEW_SCENARIOS.has(scenario) ? { ...PREVIEW_FORM_VALUES } : null
      autoSubmitVersion += 1
      router.navigate(`${pathOf('signIn')}${withPreviewScenario('', scenario)}`, { replace: onSignIn })
      notify()
    },
    takeAutoSubmit() {
      const values = autoSubmit
      autoSubmit = null
      return values
    },
    getAutoSubmitVersion: () => autoSubmitVersion,
    subscribe(listener) {
      listeners.add(listener)
      const unsubscribeRouter = router.subscribe(listener)
      return () => {
        listeners.delete(listener)
        unsubscribeRouter()
      }
    },
  }

  return {
    gateway: createPreviewAuthGateway(getScenario),
    controls,
    dispose() {
      unsubscribe()
      listeners.clear()
      delete document.documentElement.dataset.preview
    },
  }
}
