import { FORMAT_LOCALE, type Locale } from './locale'

/** CLDR plural categories. French puts 0 and 1 in `one`; English only 1. */
export type PluralForms = { readonly other: string } & Partial<Record<Exclude<Intl.LDMLPluralRule, 'other'>, string>>

/**
 * Selects the message form for a count with `Intl.PluralRules`, never with a
 * hand-written `n > 1` test. A category without its own form uses `other`.
 */
export function createPluralSelector(locale: Locale): (count: number, forms: PluralForms) => string {
  const rules = new Intl.PluralRules(FORMAT_LOCALE[locale])
  return (count, forms) => forms[rules.select(count)] ?? forms.other
}
