import { useId } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { Messages } from '../../i18n/messages'
import type { AppearancePreference } from './appearance'
import { useAppearance } from './useAppearance'
import './appearance-switch.css'

const OPTIONS: readonly { value: AppearancePreference; label: keyof Pick<Messages['appearance'], 'system' | 'light' | 'dark'> }[] = [
  { value: 'system', label: 'system' },
  { value: 'light', label: 'light' },
  { value: 'dark', label: 'dark' },
]

/** Native radio group as a segmented control (handoff §6 AppearanceSwitch, U7). Applied immediately. */
export function AppearanceSwitch() {
  const { preference, setPreference } = useAppearance()
  const name = useId()
  const { m } = useI18n()
  return (
    <fieldset className="ag-appearance">
      <legend className="ag-appearance__legend">{m.appearance.legend}</legend>
      <div className="ag-segmented">
        {OPTIONS.map((option) => (
          <label key={option.value} className="ag-segmented__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={preference === option.value}
              onChange={() => setPreference(option.value)}
            />
            {m.appearance[option.label]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
