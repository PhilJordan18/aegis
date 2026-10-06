import { useId } from 'react'
import { parseAppearancePreference } from '../features/appearance/appearance'
import { useAppearance } from '../features/appearance/useAppearance'
import { usePreviewControls, useSignInPreviewScenario } from './PreviewContext'
import { PREVIEW_ONLY_TAG } from './previewOnlyTag'
import './preview-strip.css'

/**
 * PREVIEW ONLY — in-flow strip at the top of the document (never fixed, so it
 * never covers a focus target), with the state and theme switchers
 * (handoff §6 Preview switcher). Deliberately unlike the product: magenta, dashed.
 */
export default function PreviewStrip() {
  const controls = usePreviewControls()
  const scenario = useSignInPreviewScenario()
  const { preference, setPreference } = useAppearance()
  const ids = { state: useId(), theme: useId() }
  if (!controls) return null

  return (
    <div className="ag-preview-strip" role="region" aria-label="Mode aperçu" data-preview-strip={PREVIEW_ONLY_TAG}>
      <p className="ag-preview-strip__label">Mode aperçu — aucune connexion réelle, données fictives</p>
      <div className="ag-preview-strip__controls">
        <label htmlFor={ids.state}>État</label>
        <select id={ids.state} value={scenario ?? 'inactif'} onChange={(event) => controls.showSignInScenario(event.target.value)}>
          {controls.signInScenarios.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <label htmlFor={ids.theme}>Thème</label>
        <select
          id={ids.theme}
          value={preference}
          onChange={(event) => {
            const next = parseAppearancePreference(event.target.value)
            if (next) setPreference(next)
          }}
        >
          <option value="system">Système</option>
          <option value="light">Clair</option>
          <option value="dark">Sombre</option>
        </select>
      </div>
    </div>
  )
}
