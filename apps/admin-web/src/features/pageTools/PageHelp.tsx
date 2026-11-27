import type { ReactNode } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import type { PageHelpState } from './usePageHelp'
import './page-tools.css'

/** « Aide », to the right of the title: a disclosure button, never a hover tooltip. */
export function HelpButton({ help }: { readonly help: PageHelpState }) {
  const { m } = useI18n()
  return (
    <Button variant="secondary" size="sm" aria-expanded={help.open} aria-controls={help.panelId} onClick={help.toggle}>
      <Icon name="info" />
      {m.pageTools.help}
    </Button>
  )
}

/** The panel under the title: the caveats moved out of the modules, the time zone, the meaning of the chips. */
export function HelpPanel({ help, children }: { readonly help: PageHelpState; readonly children: ReactNode }) {
  const { m } = useI18n()
  return (
    <section id={help.panelId} className="ag-help-panel" aria-label={m.pageTools.helpTitle} hidden={!help.open}>
      {children}
    </section>
  )
}
