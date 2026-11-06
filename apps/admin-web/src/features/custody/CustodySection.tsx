import { useRef, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import type { AdminAssetView } from '../catalog/contract'
import { ArchiveDialog } from '../catalog/forms/ArchiveDialog'
import { technicalInstantLabel } from '../lockers/lockerPresentation'
import { AssignIdentifierDialog } from './AssignIdentifierDialog'
import type { AssetIdentifierView } from './contract'
import { identifierTypeLabel } from './custodyPresentation'
import { PlacementDialog } from './PlacementDialog'
import { useCustodyMutations, useIdentifiers } from './useCustody'
import './custody.css'

type Intent = { readonly kind: 'assign' } | { readonly kind: 'revoke'; readonly identifier: AssetIdentifierView } | { readonly kind: 'place' }


interface CustodySectionProps {
  readonly asset: AdminAssetView
  /** A sentence for the page's outcome live region. */
  readonly onOutcome: (message: string) => void
}

/**
 * Identifiers and placement of one unit (CAT-02 #26). Every change is a server command; the history and the
 * placement are read again after it. An archived unit is read only: the server would refuse with ASSET_ARCHIVED.
 */
export function CustodySection({ asset, onOutcome }: CustodySectionProps) {
  const i18n = useI18n()
  const t = i18n.m.custody
  const identifiers = useIdentifiers(asset.id)
  const { assign, revoke, place } = useCustodyMutations(asset.id)
  const editable = asset.archivedAt === null
  // One dialog instance per opening (a new `key`); kept mounted once closed so focus goes back to its opener.
  const [intent, setIntent] = useState<(Intent & { readonly session: number; readonly open: boolean }) | null>(null)
  const sessions = useRef(0)
  const openIntent = (next: Intent) => setIntent({ ...next, session: ++sessions.current, open: true })
  const close = () => setIntent((current) => current && { ...current, open: false })

  return (
    <div className="ag-custody">
      <section className="ag-custody__block" aria-labelledby={`custody-place-${asset.id}`}>
        <div className="ag-custody__head">
          <h3 className="ag-overline ag-sec-title" id={`custody-place-${asset.id}`}>
            {t.placementTitle}
          </h3>
          {editable && (
            <Button variant="secondary" size="sm" onClick={() => openIntent({ kind: 'place' })}>
              {t.changePlacement}
            </Button>
          )}
        </div>
        <p className="ag-tnum">{asset.placement ? `${asset.placement.lockerCode} · ${asset.placement.compartmentCode}` : i18n.m.equipment.noPlacement}</p>
      </section>

      <section className="ag-custody__block" aria-labelledby={`custody-ids-${asset.id}`}>
        <div className="ag-custody__head">
          <h3 className="ag-overline ag-sec-title" id={`custody-ids-${asset.id}`}>
            {t.identifiersTitle}
          </h3>
          {editable && (
            <Button variant="secondary" size="sm" onClick={() => openIntent({ kind: 'assign' })}>
              {t.assign}
            </Button>
          )}
        </div>
        {identifiers.isPending ? (
          <p className="ag-help" role="status">
            {t.identifiersLoading}
          </p>
        ) : identifiers.isError ? (
          <p className="ag-help">
            {t.identifiersUnavailable}{' '}
            <Button variant="ghost" size="sm" onClick={() => void identifiers.refetch()}>
              {i18n.m.catalogEdit.retry}
            </Button>
          </p>
        ) : identifiers.data.length === 0 ? (
          <p className="ag-help">{t.noIdentifier}</p>
        ) : (
          <ul className="ag-custody__ids" aria-label={t.historyLabel}>
            {identifiers.data.map((identifier) => {
              const type = identifierTypeLabel(identifier.type, i18n)
              const assigned = technicalInstantLabel(identifier.assignedAt, i18n)
              const revoked = technicalInstantLabel(identifier.revokedAt, i18n)
              return (
                <li key={identifier.id} className="ag-custody__id" data-active={identifier.active || undefined}>
                  <div className="ag-custody__id-main">
                    <span className="ag-custody__type">{type}</span>
                    <span className="ag-custody__value ag-tnum">{identifier.value}</span>
                  </div>
                  <div className="ag-custody__id-meta">
                    <StatusChip role={identifier.active ? 'progress' : 'neutral'} icon="status-info">
                      {identifier.active ? t.active : t.revoked}
                    </StatusChip>
                    <span className="ag-help">{identifier.active || revoked === null ? (assigned && t.assignedOn({ time: assigned })) : t.revokedOn({ time: revoked })}</span>
                    {editable && identifier.active && (
                      <Button variant="ghost" size="sm" aria-label={t.revokeLabel({ type, value: identifier.value })} onClick={() => openIntent({ kind: 'revoke', identifier })}>
                        {t.revoke}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {intent?.kind === 'assign' && (
        <AssignIdentifierDialog
          key={intent.session}
          open={intent.open}
          assetCode={asset.assetCode}
          busy={assign.isPending}
          assign={(request, idempotencyKey) => assign.mutateAsync({ request, idempotencyKey })}
          onClose={close}
          onAssigned={() => {
            close()
            onOutcome(t.assigned({ code: asset.assetCode }))
          }}
        />
      )}
      {intent?.kind === 'revoke' && (
        <ArchiveDialog
          key={intent.session}
          open={intent.open}
          title={t.revokeTitle({ type: identifierTypeLabel(intent.identifier.type, i18n), value: intent.identifier.value })}
          consequence={t.revokeBody}
          guard={t.revokeGuard}
          confirmLabel={t.revoke}
          archive={(idempotencyKey) => revoke.mutateAsync({ identifierId: intent.identifier.id, idempotencyKey })}
          onClose={close}
          onArchived={() => {
            close()
            onOutcome(t.revokedOutcome({ code: asset.assetCode }))
          }}
        />
      )}
      {intent?.kind === 'place' && (
        <PlacementDialog
          key={intent.session}
          open={intent.open}
          assetId={asset.id}
          assetCode={asset.assetCode}
          current={asset.placement}
          busy={place.isPending}
          place={(request) => place.mutateAsync(request)}
          onClose={close}
          onPlaced={(placement) => {
            close()
            onOutcome(t.placed({ code: asset.assetCode, locker: placement.lockerCode, compartment: placement.compartmentCode }))
          }}
        />
      )}
    </div>
  )
}
