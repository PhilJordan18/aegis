import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AppearanceSwitch } from '../../features/appearance/AppearanceSwitch'
import type { UserProfile } from '../../features/auth/contract'
import { Brand } from '../../ui/Brand'
import { Icon, type IconName } from '../../ui/Icon'
import { Link } from '../Link'
import { pathOf } from '../routes'
import './shell.css'

/** Order imposed by sections.md §5 and handoff §6 SidebarNav. Only Équipements exists in this slice. */
const SECTIONS: readonly { label: string; icon: IconName; path: string | null }[] = [
  { label: "Vue d'ensemble", icon: 'grid', path: null },
  { label: 'Équipements', icon: 'box', path: pathOf('equipmentPreview') },
  { label: 'Réservations et prêts', icon: 'calendar', path: null },
  { label: 'Casiers', icon: 'locker', path: null },
  { label: 'Anomalies', icon: 'alert', path: null },
  { label: 'Audit', icon: 'list', path: null },
]

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('fr-CA') ?? '')
    .join('')
}

interface ShellProps {
  readonly currentPath: string
  readonly profile: UserProfile
  readonly onSignOut: () => void
  readonly children: ReactNode
}

export function ManagerShell({ currentPath, profile, onSignOut, children }: ShellProps) {
  return (
    <div className="ag-shell">
      <div className="ag-shell__bg ag-decor" aria-hidden="true" />
      <a className="ag-skip" href="#contenu">
        Aller au contenu principal
      </a>
      <nav className="ag-side ag-glass" aria-label="Sections">
        <div className="ag-side__brand">
          <Brand />
        </div>
        <SectionList currentPath={currentPath} />
        <AccountMenu profile={profile} onSignOut={onSignOut} />
      </nav>
      <div className="ag-shell__main">
        <CompactNav currentPath={currentPath} profile={profile} onSignOut={onSignOut} />
        {children}
      </div>
    </div>
  )
}

function SectionList({ currentPath }: { readonly currentPath: string }) {
  return (
    <>
      <ul className="ag-nav">
        {SECTIONS.map((section) => (
          <li key={section.label}>
            {section.path !== null ? (
              <Link className="ag-nav__item" to={section.path} aria-current={section.path === currentPath ? 'page' : undefined}>
                <Icon name={section.icon} />
                {section.label}
              </Link>
            ) : (
              <span className="ag-nav__item ag-nav__item--soon" aria-disabled="true">
                <Icon name={section.icon} />
                {section.label}
                <span className="ag-sr-only">, à venir</span>
                <span className="ag-soon" aria-hidden="true" />
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="ag-nav__legend" aria-hidden="true">
        <span className="ag-soon" />
        Section à venir
      </p>
    </>
  )
}

function AccountDetails({ profile, onSignOut }: { readonly profile: UserProfile; readonly onSignOut: () => void }) {
  return (
    <>
      <div className="ag-menu__id">
        <span className="ag-menu__name">{profile.displayName}</span>
        <span className="ag-menu__mail">{profile.email}</span>
      </div>
      <div className="ag-menu__sep" />
      <AppearanceSwitch />
      <div className="ag-menu__sep" />
      <button type="button" className="ag-menu__item" onClick={onSignOut}>
        <Icon name="logout" />
        Se déconnecter
      </button>
    </>
  )
}

/** Disclosure, not role="menu": Tab moves through it, Escape and an outside click close it (handoff §6). */
function AccountMenu({ profile, onSignOut }: { readonly profile: UserProfile; readonly onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div className="ag-account" ref={containerRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="ag-account__button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ag-avatar" aria-hidden="true">
          {initials(profile.displayName)}
        </span>
        <span className="ag-account__who">
          <span className="ag-account__name">{profile.displayName}</span>
          <span className="ag-account__role">Administrateur</span>
        </span>
        <Icon name="updown" className="ag-account__chevron" />
      </button>
      <div id={panelId} className="ag-menu" role="group" aria-label="Compte" hidden={!open}>
        <AccountDetails profile={profile} onSignOut={onSignOut} />
      </div>
    </div>
  )
}

/** Below 1024 px: glass top bar and a modal drawer (native <dialog>: focus trapped, Escape, focus returned). */
function CompactNav({ currentPath, profile, onSignOut }: Omit<ShellProps, 'children'>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  function close() {
    dialogRef.current?.close()
  }

  // A modal <dialog> makes the page inert, but Tab can still leave for the browser chrome: wrap it.
  function wrapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div className="ag-topbar ag-glass">
        <Brand />
        <button
          ref={triggerRef}
          type="button"
          className="ag-icon-button"
          aria-label="Ouvrir le menu"
          aria-haspopup="dialog"
          onClick={() => dialogRef.current?.showModal()}
        >
          <Icon name="menu" />
        </button>
      </div>
      <dialog
        ref={dialogRef}
        className="ag-drawer"
        aria-labelledby={titleId}
        onClose={() => triggerRef.current?.focus()}
        onKeyDown={wrapFocus}
        onClick={(event) => {
          // Backdrop click, or a link followed from inside the drawer.
          if (event.target === event.currentTarget || (event.target as Element).closest('a')) close()
        }}
      >
        <div className="ag-drawer__panel">
          <div className="ag-drawer__head">
            <h2 id={titleId} className="ag-drawer__title">
              Menu
            </h2>
            <button type="button" className="ag-icon-button" aria-label="Fermer le menu" onClick={close}>
              <Icon name="close" />
            </button>
          </div>
          <nav aria-label="Sections">
            <SectionList currentPath={currentPath} />
          </nav>
          <div className="ag-drawer__account" role="group" aria-label="Compte">
            <AccountDetails profile={profile} onSignOut={onSignOut} />
          </div>
        </div>
      </dialog>
    </>
  )
}
