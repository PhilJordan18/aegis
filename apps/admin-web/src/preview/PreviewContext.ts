import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * Programmatic preview controls used by the preview switcher. The value is
 * null outside preview builds; the implementation lives in preview-only code.
 */
export interface PreviewControls {
  readonly signInScenarios: readonly string[]
  getSignInScenario(): string | null
  /** Replaces the scenario in the URL; unknown values are ignored. */
  setSignInScenario(scenario: string | null): void
  /**
   * Shows a scenario on the sign-in page. Outcome scenarios (refused
   * credentials, rate limit…) also queue one submission of fictitious values,
   * which goes through the real form, gateway and mapping.
   */
  showSignInScenario(scenario: string): void
  /** Takes the queued fictitious values, at most once. */
  takeAutoSubmit(): { email: string; password: string } | null
  /** Changes whenever a submission is queued. */
  getAutoSubmitVersion(): number
  subscribe(listener: () => void): () => void
}

export const PreviewContext = createContext<PreviewControls | null>(null)

export function usePreviewControls(): PreviewControls | null {
  return useContext(PreviewContext)
}

const noopSubscribe = () => () => {}
const nullValue = () => null
const zero = () => 0

export function useSignInPreviewScenario(): string | null {
  const controls = usePreviewControls()
  return useSyncExternalStore(controls?.subscribe ?? noopSubscribe, controls?.getSignInScenario ?? nullValue)
}

export function useSignInPreviewAutoSubmit(): number {
  const controls = usePreviewControls()
  return useSyncExternalStore(controls?.subscribe ?? noopSubscribe, controls?.getAutoSubmitVersion ?? zero)
}
