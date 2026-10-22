import { PageHeading } from '../app/PageHeading'
import { useRouter } from '../app/router'
import { pathOf } from '../app/routes'
import { ManagerShell } from '../app/shell/ManagerShell'
import type { UserProfile } from '../features/auth/contract'
import { useSessionStore } from '../features/auth/session'
import { useCurrentAdminProfile } from '../features/auth/useCurrentAdminProfile'
import { useI18n } from '../i18n/useI18n'
import { Alert } from '../ui/Alert'
import '../app/page.css'

/**
 * First protected Manager page, reached after a real sign-in. It reads only
 * GET /auth/me (WEB-01); the equipment list, its loading, empty, error and
 * stale states belong to CAT-01 and RDY-02.
 */
export function EquipmentPage({ sessionProfile }: { readonly sessionProfile: UserProfile }) {
  const { m } = useI18n()
  const sessionStore = useSessionStore()
  const router = useRouter()
  const currentProfile = useCurrentAdminProfile()
  // The login response already carries the profile (states.md §1); /auth/me refreshes it.
  const profile = currentProfile.data ?? sessionProfile

  function signOut() {
    sessionStore.signOut()
    router.navigate(pathOf('signIn'))
  }

  return (
    <ManagerShell currentPath={pathOf('equipment')} profile={profile} onSignOut={signOut}>
      <main id="contenu" className="ag-page" tabIndex={-1}>
        <header className="ag-page__head">
          <div className="ag-page__titles">
            <PageHeading className="ag-page__title">{m.equipment.heading}</PageHeading>
          </div>
        </header>
        <Alert kind="info" icon="status-info" title={m.equipment.pendingTitle} />
      </main>
    </ManagerShell>
  )
}
