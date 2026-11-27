import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import type { IndexHealth } from './labelIndex'
import './labels.css'

/**
 * « Libellés non chargés · Réessayer » (§1.1): the page stays usable with abbreviated identifiers. Shown only when no
 * label read succeeded; a partial index is said in the page help instead.
 */
export function LabelIndexNotice({ health, onRetry }: { readonly health: IndexHealth; readonly onRetry: () => void }) {
  const { m } = useI18n()
  if (health !== 'failed') return null
  return (
    <p className="ag-label-notice">
      <Icon name="info" />
      <span>{m.labels.notLoaded}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {m.labels.retry}
      </Button>
    </p>
  )
}
