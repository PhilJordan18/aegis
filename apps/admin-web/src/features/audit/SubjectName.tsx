import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { useI18n } from '../../i18n/useI18n'
import { IdText } from '../labels/IdText'
import type { LabelIndex } from '../labels/labelIndex'
import type { AssetSummary } from '../transactions/contract'
import { subjectLabel } from './auditPresentation'

type Kind = 'operations' | 'reservations' | 'loans'
const CACHED_KIND: Readonly<Record<string, Kind>> = { LOCKER_OPERATION: 'operations', RESERVATION: 'reservations', LOAN: 'loans' }

/**
 * The unit of a reservation, loan or operation, when this session already read it (contract §1.2, « via `asset` de
 * l'opération si elle est déjà en cache »): no request is made for an audit row.
 */
function cachedAsset(client: QueryClient, subjectType: string, id: string): AssetSummary | null {
  const kind = CACHED_KIND[subjectType]
  if (kind === undefined) return null
  const detail = client.getQueryData<{ asset?: AssetSummary }>(['transactions', kind, 'detail', id])
  if (detail?.asset !== undefined) return detail.asset
  for (const [, page] of client.getQueriesData<{ items?: readonly { id: string; asset?: AssetSummary }[] }>({ queryKey: [...queryKeys.transactions.all, kind, 'list'] })) {
    const found = page?.items?.find((item) => item.id === id)
    if (found?.asset !== undefined) return found.asset
  }
  return null
}

function knownText(subjectType: string, id: string, labels: LabelIndex, client: QueryClient, cell: (value: { code: string }) => string): string | null {
  switch (subjectType) {
    case 'ASSET': {
      const label = labels.asset(id)
      return label.kind === 'known' ? label.code : null
    }
    case 'COMPARTMENT': {
      const label = labels.compartment(id)
      return label.kind === 'known' ? `${cell({ code: label.code })} · ${label.lockerCode}` : null
    }
    case 'LOCKER': {
      const label = labels.locker(id)
      return label.kind === 'known' ? label.code : null
    }
    default:
      return cachedAsset(client, subjectType, id)?.assetCode ?? null
  }
}

/** « Opération · MM-001 », « Cellule · Cellule A2 · AEGIS-DEMO-01 »; the type and the abbreviated identifier otherwise. */
export function SubjectName({ subjectType, subjectId, labels }: { readonly subjectType: string; readonly subjectId: string; readonly labels: LabelIndex }) {
  const i18n = useI18n()
  const client = useQueryClient()
  const text = knownText(subjectType, subjectId, labels, client, i18n.m.labels.cell)
  return (
    <>
      {subjectLabel(subjectType, i18n)} · {text ?? <IdText id={subjectId} />}
    </>
  )
}
