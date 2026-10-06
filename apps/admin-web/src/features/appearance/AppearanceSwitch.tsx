import { useId } from 'react'
import type { AppearancePreference } from './appearance'
import { useAppearance } from './useAppearance'
import './appearance-switch.css'

const OPTIONS: readonly { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
]

/** Native radio group as a segmented control (handoff §6 AppearanceSwitch, U7). Applied immediately. */
export function AppearanceSwitch() {
  const { preference, setPreference } = useAppearance()
  const name = useId()
  return (
    <fieldset className="ag-appearance">
      <legend className="ag-appearance__legend">Apparence</legend>
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
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
