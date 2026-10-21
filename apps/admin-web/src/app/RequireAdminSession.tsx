import { useEffect, type ReactNode } from 'react'
import type { UserProfile } from '../features/auth/contract'
import { useSession } from '../features/auth/session'
import { useRouter } from './router'
import { pathOf } from './routes'

/**
 * Renders a protected page only with an administrator session. Without one —
 * never signed in, page reloaded, signed out, expired or rejected by a 401 —
 * it replaces the history entry with /connexion, which shows the arrival
 * reason kept by the session store (states.md §1).
 */
export function RequireAdminSession({ children }: { readonly children: (profile: UserProfile) => ReactNode }) {
  const session = useSession()
  const router = useRouter()
  const authenticated = session.status === 'authenticated'

  useEffect(() => {
    if (!authenticated) router.navigate(pathOf('signIn'), { replace: true })
  }, [authenticated, router])

  return session.status === 'authenticated' ? children(session.profile) : null
}
