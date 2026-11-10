import { useEffect, useId, useRef, useState } from 'react'
import { pathOf } from '../../app/routes'
import { useI18n } from '../../i18n/useI18n'
import { Brand } from '../../ui/Brand'
import { Button, ButtonLink } from '../../ui/Button'
import { LanguageSwitch } from '../language/LanguageSwitch'
import { SECTION_IDS } from './sections'

/**
 * Landing header (handoff §4.1): brand, section links from 1024 px, the language switch, and
 * « Se connecter » at every width. Below 1024 px the links move to an opaque sheet under the header,
 * opened by « Sections » and closed by Escape, by a link, or by the same button.
 */
export function LandingHeader() {
  const { m } = useI18n()
  const t = m.landing
  const [open, setOpen] = useState(false)
  const sheetId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const links = (onNavigate?: () => void) =>
    SECTION_IDS.map((id) => (
      <a key={id} href={`#${id}`} onClick={onNavigate}>
        {t.nav[id]}
      </a>
    ))

  return (
    <header className="lp-head">
      <div className="lp-wrap lp-head__bar">
        <Brand />
        <nav className="lp-head__nav" aria-label={t.sectionsNavLabel}>
          {links()}
        </nav>
        <div className="lp-head__tools">
          <Button
            ref={buttonRef}
            variant="secondary"
            size="sm"
            className="lp-head__menu"
            aria-expanded={open}
            aria-controls={sheetId}
            onClick={() => setOpen((value) => !value)}
          >
            {t.sectionsMenu}
          </Button>
          <div className="lp-head__language">
            <LanguageSwitch compact />
          </div>
          <ButtonLink to={pathOf('signIn')} variant="primary" size="sm" className="lp-head__sign-in">
            {t.signIn}
          </ButtonLink>
        </div>
      </div>
      <div id={sheetId} className="lp-sheet" hidden={!open}>
        <div className="lp-wrap lp-sheet__body">
          <nav aria-label={t.sectionsNavLabel}>{links(() => setOpen(false))}</nav>
          <LanguageSwitch compact />
        </div>
      </div>
    </header>
  )
}
