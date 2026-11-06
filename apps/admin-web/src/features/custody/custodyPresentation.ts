import type { I18n } from '../../i18n/useI18n'
import { IDENTIFIER_TYPES, type IdentifierType } from './contract'

/** A type this client does not know is named as sent, never hidden. */
export function identifierTypeLabel(type: string, { m }: I18n): string {
  return (IDENTIFIER_TYPES as readonly string[]).includes(type) ? m.custody.type[type as IdentifierType] : m.custody.unknownType({ type })
}
