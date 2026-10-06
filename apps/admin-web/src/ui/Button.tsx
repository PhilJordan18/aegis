import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from '../app/Link'
import { buttonClass, type ButtonLook as Look } from './buttonClass'
import { Spinner } from './Icon'
import './button.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Look & {
    /** Busy: spinner and `aria-disabled`, focus kept, clicks ignored by the caller (handoff §6). */
    readonly busy?: boolean
    /** Inert but focusable (`aria-disabled`), styled as disabled; the caller ignores activation. */
    readonly inert?: boolean
    /**
     * Preview action: `aria-disabled`, normal look, described by the « Aperçu
     * visuel » bar (handoff §6). Activation does nothing.
     */
    readonly previewInert?: boolean
    readonly children: ReactNode
  }

export function Button({
  variant,
  size,
  block,
  busy = false,
  inert = false,
  previewInert = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const unavailable = busy || inert || previewInert
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={unavailable || undefined}
      className={buttonClass({ variant, size, block }, [busy && 'is-busy', inert && 'is-inert', className].filter(Boolean).join(' '))}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function ButtonLink({ to, children, className, ...look }: Look & { readonly to: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <Link to={to} className={buttonClass(look, className)}>
      {children}
    </Link>
  )
}
