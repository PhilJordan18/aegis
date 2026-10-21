import { useId } from 'react'
import { LANGUAGE_NAMES, LOCALES, parseLocale } from '../../i18n/locale'
import { useI18n, useLocale } from '../../i18n/useI18n'
import './language-switch.css'

/**
 * « Français / English » as a native radio group (same segmented control as the
 * appearance switch), applied at once. Each option is written in its own
 * language and carries its own `lang`; no flags. `compact` hides the legend
 * visually (it stays the group's accessible name) for the page headers.
 */
export function LanguageSwitch({ compact = false }: { readonly compact?: boolean }) {
  const { locale, setLocale } = useLocale()
  const { m } = useI18n()
  const name = useId()
  return (
    <fieldset className={compact ? 'ag-language ag-language--compact' : 'ag-language'}>
      <legend className={compact ? 'ag-sr-only' : 'ag-language__legend'}>{m.language.legend}</legend>
      <div className="ag-segmented ag-segmented--pair">
        {LOCALES.map((option) => (
          <label key={option} className="ag-segmented__option">
            <input
              type="radio"
              name={name}
              value={option}
              checked={locale === option}
              onChange={(event) => {
                const next = parseLocale(event.target.value)
                if (next) setLocale(next)
              }}
            />
            <span lang={option}>{LANGUAGE_NAMES[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
