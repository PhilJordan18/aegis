import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AppearanceSwitch } from '../../features/appearance/AppearanceSwitch'
import type { UserProfile } from '../../features/auth/contract'
import { LanguageSwitch } from '../../features/language/LanguageSwitch'
import type { Messages } from '../../i18n/messages'
import { useI18n } from '../../i18n/useI18n'
import { Brand } from '../../ui/Brand'
import { Icon, type IconName } from '../../ui/Icon'
import { Link } from '../Link'
import { pathOf } from '../routes'
import './shell.css'

/**
 * Order imposed by sections.md §5 and handoff §6 SidebarNav. Only Équipements exists in this slice:
 * the static preview in design-review builds, the protected page otherwise.
 */
const SECTIONS: readonly { id: keyof Messages['shell']['sections']; icon: IconName; path: string | null }[] = [
  { id: 'overview', icon: 'grid', path: null },
  { id: 'equipment', icon: 'box', path: pathOf(__AEGIS_PREVIEW__ ? 'equipmentPreview' : 'equipment') },
  { id: 'reservationsLoans', icon: 'calendar', path: null },
  { id: 'lockers', icon: 'locker', path: null },
  { id: 'anomalies', icon: 'alert', path: null },
  { id: 'audit', icon: 'list', path: null },
]

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function initials(displayName: string, upperCase: (value: string) => string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => upperCase(part[0] ?? ''))
    .join('')
}

interface ShellProps {
  readonly currentPath: string
  readonly profile: UserProfile
  readonly onSignOut: () => void
  readonly children: ReactNode
}

export function ManagerShell({ currentPath, profile, onSignOut, children }: ShellProps) {
  const { m } = useI18n()
  return (
    <div className="ag-shell">
      <div className="ag-shell__bg ag-decor" aria-hidden="true" />
      <a className="ag-skip" href="#contenu">
        {m.shell.skipLink}
      </a>
      <nav className="ag-side ag-glass" aria-label={m.shell.sectionsLabel}>
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
  const { m } = useI18n()
  return (
    <>
      <ul className="ag-nav">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            {section.path !== null ? (
              <Link className="ag-nav__item" to={section.path} aria-current={section.path === currentPath ? 'page' : undefined}>
                <Icon name={section.icon} />
                {m.shell.sections[section.id]}
              </Link>
            ) : (
              <span className="ag-nav__item ag-nav__item--soon" aria-disabled="true">
                <Icon name={section.icon} />
                {m.shell.sections[section.id]}
                <span className="ag-sr-only">{m.shell.soonSuffix}</span>
                <span className="ag-soon" aria-hidden="true" />
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="ag-nav__legend" aria-hidden="true">
        <span className="ag-soon" />
        {m.shell.soonLegend}
      </p>
    </>
  )
}

function AccountDetails({ profile, onSignOut }: { readonly profile: UserProfile; readonly onSignOut: () => void }) {
  const { m } = useI18n()
  return (
    <>
      <div className="ag-menu__id">
        <span className="ag-menu__name">{profile.displayName}</span>
        <span className="ag-menu__mail">{profile.email}</span>
      </div>
      <div className="ag-menu__sep" />
      <AppearanceSwitch />
      <div className="ag-menu__sep" />
      <LanguageSwitch />
      <div className="ag-menu__sep" />
      <button type="button" className="ag-menu__item" onClick={onSignOut}>
        <Icon name="logout" />
        {m.shell.signOut}
      </button>
    </>
  )
}

/** Disclosure, not role="menu": Tab moves through it, Escape and an outside click close it (handoff §6). */
function AccountMenu({ profile, onSignOut }: { readonly profile: UserProfile; readonly onSignOut: () => void }) {
  const { m, format } = useI18n()
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
          {initials(profile.displayName, format.upperCase)}
        </span>
        <span className="ag-account__who">
          <span className="ag-account__name">{profile.displayName}</span>
          <span className="ag-account__role">{m.shell.administratorRole}</span>
        </span>
        <Icon name="updown" className="ag-account__chevron" />
      </button>
      <div id={panelId} className="ag-menu" role="group" aria-label={m.shell.accountLabel} hidden={!open}>
        <AccountDetails profile={profile} onSignOut={onSignOut} />
      </div>
    </div>
  )
}

/** Below 1024 px: glass top bar and a modal drawer (native <dialog>: focus trapped, Escape, focus returned). */
function CompactNav({ currentPath, profile, onSignOut }: Omit<ShellProps, 'children'>) {
  const { m } = useI18n()
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
          aria-label={m.shell.openMenu}
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
              {m.shell.menuTitle}
            </h2>
            <button type="button" className="ag-icon-button" aria-label={m.shell.closeMenu} onClick={close}>
              <Icon name="close" />
            </button>
          </div>
          <nav aria-label={m.shell.sectionsLabel}>
            <SectionList currentPath={currentPath} />
          </nav>
          <div className="ag-drawer__account" role="group" aria-label={m.shell.accountLabel}>
            <AccountDetails profile={profile} onSignOut={onSignOut} />
          </div>
        </div>
      </dialog>
    </>
  )
}
