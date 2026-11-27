import { useMediaQuery } from '../landing/useMediaQuery'

/**
 * Design §8.2-8.3: the full table from 1440 px, its reduced column set from 1280 px, card rows below 1280 px. Where
 * `matchMedia` is missing (unit tests) the full table is shown.
 */
export type RecordsLayout = 'wide' | 'table' | 'cards'

export function useRecordsLayout(): RecordsLayout {
  const cards = useMediaQuery('(max-width: 1279px)')
  const reduced = useMediaQuery('(max-width: 1439px)')
  return cards ? 'cards' : reduced ? 'table' : 'wide'
}
