import { useCallback } from 'react'
import { useRouter } from '../../app/router'
import { pathOf } from '../../app/routes'
import { useSessionStore } from './session'

/**
 * Explicit sign-out (ADR-016): the server revokes the browser session first. Only once it confirmed does the
 * Manager leave for the sign-in page; on failure the session stays open and the shell shows the error with a
 * retry (`session.signOut === 'failed'`), because a reload would restore the session.
 */
export function useSignOut(): () => void {
  const session = useSessionStore()
  const router = useRouter()
  return useCallback(() => {
    void session.signOut().then((signedOut) => {
      // Protected pages are already sent there by their guard; the design-review page has none.
      if (signedOut && router.getSnapshot().pathname !== pathOf('signIn')) router.navigate(pathOf('signIn'))
    })
  }, [session, router])
}
