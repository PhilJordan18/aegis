import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { formattersFor, type Formatters } from './format'
import type { Locale, LocaleController } from './locale'
import { MESSAGES, type Messages } from './messages'

export const LocaleContext = createContext<LocaleController | null>(null)

export function useLocale(): { readonly locale: Locale; readonly setLocale: LocaleController['setLocale'] } {
  const controller = useContext(LocaleContext)
  if (!controller) throw new Error('useLocale requires a LocaleContext provider')
  const locale = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { locale, setLocale: controller.setLocale }
}

export interface I18n {
  readonly locale: Locale
  /** The catalog of the current language: `m.signIn.heading`, `m.signIn.rateLimitedBody({ duration })`. */
  readonly m: Messages
  readonly format: Formatters
}

/** Catalog and `Intl` formatters of the current language; both are stable between renders of one language. */
export function useI18n(): I18n {
  const { locale } = useLocale()
  return useMemo(() => ({ locale, m: MESSAGES[locale], format: formattersFor(locale) }), [locale])
}
