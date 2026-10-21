import { FORMAT_LOCALE, type Locale } from './locale'

export interface Formatters {
  /** « 55 secondes », « 1 seconde », « 0 seconds »: unit and plural come from `Intl`. */
  readonly seconds: (value: number) => string
  /** Countdown clock « 1:05 ». Digits come from `Intl`; the colon is the same in both languages. */
  readonly clock: (totalSeconds: number) => string
  /**
   * A calendar date, long month abbreviated (« 8 sept. 2026 », « Sep 8, 2026 »).
   * `timeZone` is explicit: a business time is shown in the locker's zone, whatever the language.
   */
  readonly date: (instant: Date, timeZone: string) => string
  /** Capitalization that follows the language's rules. */
  readonly upperCase: (value: string) => string
}

function createFormatters(locale: Locale): Formatters {
  const tag = FORMAT_LOCALE[locale]
  const seconds = new Intl.NumberFormat(tag, { style: 'unit', unit: 'second', unitDisplay: 'long' })
  const minutesDigits = new Intl.NumberFormat(tag)
  const secondsDigits = new Intl.NumberFormat(tag, { minimumIntegerDigits: 2 })
  return {
    seconds: (value) => seconds.format(value),
    clock: (totalSeconds) => {
      const whole = Math.max(0, Math.floor(totalSeconds))
      return `${minutesDigits.format(Math.floor(whole / 60))}:${secondsDigits.format(whole % 60)}`
    },
    date: (instant, timeZone) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone }).format(instant),
    upperCase: (value) => value.toLocaleUpperCase(tag),
  }
}

const cache = new Map<Locale, Formatters>()

export function formattersFor(locale: Locale): Formatters {
  let formatters = cache.get(locale)
  if (!formatters) {
    formatters = createFormatters(locale)
    cache.set(locale, formatters)
  }
  return formatters
}
