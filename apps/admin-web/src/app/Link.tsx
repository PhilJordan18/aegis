import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { useRouter } from './router'

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { readonly to: string }

/** Native anchor; only an unmodified primary click is handled client-side. */
export function Link({ to, onClick, target, ...rest }: LinkProps) {
  const router = useRouter()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target !== undefined && target !== '_self')
    ) {
      return
    }
    event.preventDefault()
    router.navigate(to)
  }

  return <a {...rest} href={to} target={target} onClick={handleClick} />
}
