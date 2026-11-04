import { useI18n } from '../i18n/useI18n'
import { Icon } from './Icon'

/** « lecture seule » next to a section title: the data below can be read here, never changed. Style: `.ag-readonly` (equipment.css). */
export function ReadOnlyMark() {
  const { m } = useI18n()
  return (
    <span className="ag-readonly">
      <Icon name="lock" />
      {m.equipment.readOnly}
    </span>
  )
}
