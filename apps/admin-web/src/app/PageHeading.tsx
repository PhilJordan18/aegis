import { useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from './router'

export const PAGE_HEADING_ID = 'titre-page'

/**
 * The single h1 of a page. After a client-side navigation it receives focus
 * so keyboard and screen-reader users start on the new content.
 */
export function PageHeading({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const router = useRouter()
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (router.consumeFocusRequest()) ref.current?.focus()
  }, [router])

  return (
    <h1 id={PAGE_HEADING_ID} ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  )
}
