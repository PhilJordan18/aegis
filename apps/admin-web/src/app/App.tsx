import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { SignInPage } from '../features/auth/SignInPage'
import { EquipmentPage } from '../pages/EquipmentPage'
import { LandingPage } from '../pages/LandingPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { useSignInPreviewScenario } from '../preview/PreviewContext'
import { RequireAdminSession } from './RequireAdminSession'
import { useLocation } from './router'
import { matchRoute, pathOf, ROUTES, type RouteId } from './routes'

// `__AEGIS_PREVIEW__` is a build-time literal: production builds drop these chunks.
const EquipmentPreviewPage: ComponentType | null = __AEGIS_PREVIEW__ ? lazy(() => import('../preview/EquipmentPreviewPage')) : null
const PreviewStrip: ComponentType | null = __AEGIS_PREVIEW__ ? lazy(() => import('../preview/PreviewStrip')) : null

// Q7 (handoff §14): the static equipment preview in design-review builds, the protected Équipements page otherwise.
const AFTER_SIGN_IN_PATH = pathOf(__AEGIS_PREVIEW__ ? 'equipmentPreview' : 'equipment')

export function App() {
  const { pathname } = useLocation()
  const routeId = matchRoute(pathname, __AEGIS_PREVIEW__)

  useEffect(() => {
    document.title = ROUTES[routeId].title
  }, [routeId])

  return (
    <>
      {PreviewStrip && (
        <Suspense fallback={null}>
          <PreviewStrip />
        </Suspense>
      )}
      <Page routeId={routeId} />
    </>
  )
}

function Page({ routeId }: { readonly routeId: RouteId }) {
  // Preview only: a new scenario remounts the sign-in page so it starts from that arrival state.
  const scenario = useSignInPreviewScenario()
  switch (routeId) {
    case 'landing':
      return <LandingPage />
    case 'signIn':
      return <SignInPage key={scenario ?? 'default'} afterSignInPath={AFTER_SIGN_IN_PATH} />
    case 'equipment':
      return <RequireAdminSession>{(profile) => <EquipmentPage sessionProfile={profile} />}</RequireAdminSession>
    case 'equipmentPreview':
      return EquipmentPreviewPage ? (
        <Suspense fallback={null}>
          <EquipmentPreviewPage />
        </Suspense>
      ) : (
        <NotFoundPage />
      )
    case 'notFound':
      return <NotFoundPage />
  }
}
