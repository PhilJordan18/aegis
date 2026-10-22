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
  /**
   * A time of day with its zone abbreviation (« 10 h 30 HAE », « 10:30 a.m. EDT »). Without `timeZone`
   * it is the device's zone, which is right for a technical instant such as an evaluation time.
   */
  readonly time: (instant: Date, timeZone?: string) => string
  /** Capitalization that follows the language's rules. */
  readonly upperCase: (value: string) => string
}

function createFormatters(locale: Locale): Formatters {
  const tag = FORMAT_LOCALE[locale]
  const seconds = new Intl.NumberFormat(tag, { style: 'unit', unit: 'second', unitDisplay: 'long' })
  const minutesDigits = new Intl.NumberFormat(tag)
  const secondsDigits = new Intl.NumberFormat(tag, { minimumIntegerDigits: 2 })
  return {
    // ICU puts a plain space between the number and its unit; a no-break space keeps « 42 secondes » on one line.
    seconds: (value) =>
      seconds
        .formatToParts(value)
        .map((part) => (part.type === 'literal' ? part.value.replace(/ /g, '\u00A0') : part.value))
        .join(''),
    clock: (totalSeconds) => {
      const whole = Math.max(0, Math.floor(totalSeconds))
      return `${minutesDigits.format(Math.floor(whole / 60))}:${secondsDigits.format(whole % 60)}`
    },
    date: (instant, timeZone) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone }).format(instant),
    time: (instant, timeZone) => new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }).format(instant),
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
