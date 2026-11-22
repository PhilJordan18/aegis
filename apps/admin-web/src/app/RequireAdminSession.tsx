import { useEffect, type ReactNode } from 'react'
import type { UserProfile } from '../features/auth/contract'
import { SessionRestoreScreen } from '../features/auth/SessionRestore'
import { useSession } from '../features/auth/session'
import { signInPathFor } from './returnPath'
import { useRouter } from './router'
import { pathOf } from './routes'

/**
 * Renders a protected page only with an administrator session. While the boot refresh has not answered
 * (`restoring`) or could not be answered (`restoreFailed`) it shows that state and never redirects: the
 * server, not the page, decides whether the browser still holds a session (ADR-016). Without a session —
 * never signed in, signed out, expired, revoked or rejected by a 401 — it replaces the history entry with
 * /connexion once, remembering the requested page so that the next sign-in comes back to it. The sign-in page
 * shows the arrival reason kept by the session store (states.md §1). After an explicit sign-out nothing is
 * remembered.
 */
export function RequireAdminSession({ children }: { readonly children: (profile: UserProfile) => ReactNode }) {
  const session = useSession()
  const router = useRouter()
  const anonymous = session.status === 'anonymous'
  const signedOut = anonymous && session.arrivalReason === 'signedOut'

  useEffect(() => {
    if (!anonymous) return
    router.navigate(signedOut ? pathOf('signIn') : signInPathFor(router.getSnapshot()), { replace: true })
  }, [anonymous, signedOut, router])

  if (session.status === 'authenticated') return children(session.profile)
  return <SessionRestoreScreen />
}
