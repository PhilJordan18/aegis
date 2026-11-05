import type { Locale } from '../locale'
import { en } from './en'
import { fr } from './fr'

/** The shape of every catalog is the French one: the other languages are typed against it. */
export type Messages = typeof fr

export const MESSAGES: Readonly<Record<Locale, Messages>> = { fr, en }
