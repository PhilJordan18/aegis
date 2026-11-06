import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { Icon } from './Icon'
import './dialog.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  readonly open: boolean
  readonly title: string
  /** Read after the title (`aria-describedby`): what the dialog does, or the consequence it confirms. */
  readonly description?: ReactNode
  /** Escape, the close button and the backdrop call it. Ignored while `busy`, so a pending command keeps its dialog. */
  readonly onClose: () => void
  readonly busy?: boolean
  /** `alertdialog` for a confirmation of a consequential action (WAI-ARIA APG). */
  readonly role?: 'dialog' | 'alertdialog'
  readonly size?: 'md' | 'sm'
  readonly children: ReactNode
}

/**
 * Modal dialog on the native `<dialog>` (as the shell drawer): the page is inert, Escape closes, focus is
 * wrapped and given back to the element that had it when the dialog opened. The body scrolls on its own, so
 * the title and the actions stay in view at 320 px and at 200 % zoom.
 */
export function Dialog({ open, title, description, onClose, busy = false, role = 'dialog', size = 'md', children }: DialogProps) {
  const { m } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      // An element marked autofocus takes focus; otherwise the dialog itself, so the title is read first.
      const first = dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
      ;(first ?? dialog).focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // The opener may be gone (an archived row loses its buttons): focus then goes to the page's main region.
  useEffect(() => {
    if (open) return
    const target = opener.current
    opener.current = null
    if (target === null) return
    if (target.isConnected) target.focus()
    else document.getElementById('contenu')?.focus()
  }, [open])

  function wrapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest('[hidden]'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={ref}
      className={`ag-dialog ag-dialog--${size}`}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onKeyDown={wrapFocus}
      onCancel={(event) => {
        // Escape: React state owns `open`, so the native close is replaced by the caller's.
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      {open && (
        <div className="ag-dialog__panel">
          <div className="ag-dialog__head">
            <h2 id={titleId} className="ag-dialog__title">
              {title}
            </h2>
            <button type="button" className="ag-icon-button" aria-label={m.dialog.close} onClick={() => !busy && onClose()} aria-disabled={busy || undefined}>
              <Icon name="close" />
            </button>
          </div>
          {description !== undefined && (
            <div id={descriptionId} className="ag-dialog__description">
              {description}
            </div>
          )}
          {children}
        </div>
      )}
    </dialog>
  )
}

/** Scrolling body and fixed action row of a dialog form. */
export function DialogBody({ children }: { readonly children: ReactNode }) {
  return <div className="ag-dialog__body">{children}</div>
}

export function DialogActions({ children }: { readonly children: ReactNode }) {
  return <div className="ag-dialog__actions">{children}</div>
}
