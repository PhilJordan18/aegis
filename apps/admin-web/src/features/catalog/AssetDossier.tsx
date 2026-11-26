import { useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { ReadOnlyMark } from '../../ui/ReadOnlyMark'
import { Callout, DossierActions } from '../../ui/Callout'
import { StatusChip } from '../../ui/StatusChip'
import {
  accessLevelLabel,
  archivedDateLabel,
  availabilityLabel,
  availabilityRole,
  calibrationDueLabel,
  calibrationLabel,
  diagnosticChip,
  diagnosticTone,
  evaluatedAtLabel,
  hasUnrecognizedValue,
  LAB_TIME_ZONE,
  presenceLabel,
  reasonLabel,
  serviceStateLabel,
} from './assetPresentation'
import { auditHref, NO_FILTERS as NO_AUDIT_FILTERS } from '../audit/auditFilters'
import { NO_FILTERS as NO_TRANSACTION_FILTERS, transactionHref } from '../transactions/transactionHref'
import { CatalogAlert } from './CatalogAlert'
import type { CatalogFailure } from './catalogFailure'
import type { AdminAssetView } from './contract'
import { StaleNotice } from './StaleNotice'

interface AssetDossierProps {
  readonly asset: AdminAssetView | undefined
  readonly loading: boolean
  readonly failure: CatalogFailure | null
  /** Set when a refresh failed but the previous unit is still shown. An initial failure is `failure`, not this. */
  readonly stale: boolean
  /** A refresh is running. */
  readonly retrying: boolean
  /** Focus target after a selection on a stacked layout: the scrolling group, labelled by the title. */
  readonly focusRef?: Ref<HTMLDivElement>
  readonly onRetry: () => void
  readonly onBack: () => void
  /** Edit and archive commands, shown under the title for a unit that is not archived. */
  readonly actions?: ReactNode
  /** Identifiers and placement (CAT-02 #26), below the facts. */
  readonly custody?: ReactNode
}

/**
 * Dossier of one unit (handoff §3.1); its settings change through `actions`, never in place. The reasons are the server's non-personal diagnostic
 * as sent: the page shows no readiness verdict, no « ready » and no invented presence or compartment.
 */
export function AssetDossier({ asset, loading, failure, stale, retrying, focusRef, onRetry, onBack, actions, custody }: AssetDossierProps) {
  const { m } = useI18n()
  const titleId = useId()
  const groupId = useId()
  const alertRef = useRef<HTMLDivElement>(null)
  const focusLost = useRef(false)
  const t = m.equipment

  // The stale notice that had focus is gone. Its target exists only after this commit: the unit after a successful
  // refresh, or the refusal when the server answered 403 or 404, which replaces the unit (WCAG 2.4.3).
  useLayoutEffect(() => {
    if (!focusLost.current) return
    focusLost.current = false
    ;(asset === undefined ? alertRef.current : document.getElementById(groupId))?.focus()
  })

  if (asset === undefined) {
    return (
      <section className="ag-panel ag-dossier" aria-label={t.selectedOverline} aria-busy={loading || undefined}>
        {failure !== null ? (
          <div className="ag-dossier__alert" ref={alertRef} tabIndex={-1}>
            <CatalogAlert failure={failure} onRetry={onRetry} onBack={onBack} />
          </div>
        ) : (
          <div className="ag-dossier__skel" aria-hidden="true">
            <span className="ag-skel__bar ag-skel__bar--title" />
            <span className="ag-skel__bar ag-skel__bar--block" />
            <span className="ag-skel__bar ag-skel__bar--facts" />
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="ag-panel ag-dossier" aria-labelledby={titleId}>
      {/* Scrolls on its own at ≥ 1024 px: focusable so the keyboard can scroll it (WCAG 2.1.1). */}
      <div id={groupId} className="ag-dossier__scroll" tabIndex={0} role="group" aria-labelledby={titleId} ref={focusRef}>
        <DossierBody
          asset={asset}
          titleId={titleId}
          stale={stale}
          retrying={retrying}
          onRetry={onRetry}
          returnFocus={() => (focusLost.current = true)}
          actions={actions}
          custody={custody}
        />
      </div>
    </section>
  )
}

interface DossierBodyProps {
  readonly asset: AdminAssetView
  readonly titleId: string
  readonly stale: boolean
  readonly retrying: boolean
  readonly onRetry: () => void
  readonly returnFocus: () => void
  readonly actions?: ReactNode
  /** Identifiers and placement (CAT-02 #26), below the facts. */
  readonly custody?: ReactNode
}

function DossierBody({ asset, titleId, stale, retrying, onRetry, returnFocus, actions, custody }: DossierBodyProps) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.equipment
  const reasons = asset.operationalDiagnostic.reasons
  const tone = diagnosticTone(reasons)
  const chip = diagnosticChip(asset, i18n)
  const evaluated = evaluatedAtLabel(asset, i18n)
  const model = [asset.model.manufacturer, asset.model.modelNumber].filter((part) => part !== null && part !== '').join(' ')
  const archived = archivedDateLabel(asset, i18n)
  const [first, ...others] = reasons

  return (
    <>
      {stale && (
        <div className="ag-dossier__stale">
          <StaleNotice evaluatedAt={evaluated} retrying={retrying} onRetry={onRetry} returnFocus={returnFocus} />
        </div>
      )}
      <p className="ag-overline">{t.selectedOverline}</p>
      <h2 className="ag-dossier__title" id={titleId}>
        {asset.model.name} · <span className="ag-tnum">{asset.assetCode}</span>
      </h2>
      {model !== '' && <p className="ag-dossier__sub">{model}</p>}
      {archived !== null && <p className="ag-dossier__sub">{archived}</p>}
      {asset.archivedAt !== null ? (
        <p className="ag-dossier__sub">{m.catalogEdit.archivedAssetNote}</p>
      ) : (
        actions !== undefined && <DossierActions label={m.catalogEdit.assetActions}>{actions}</DossierActions>
      )}

      <Callout
        role={tone === 'none' ? 'neutral' : tone}
        chips={
          <>
            <StatusChip role={chip.role} icon={chip.icon} size="lg">
              {chip.label}
            </StatusChip>
            <StatusChip role={availabilityRole(asset.availability)} icon="status-info" size="lg">
              {availabilityLabel(asset.availability, i18n)}
            </StatusChip>
          </>
        }
      >
        {first !== undefined && <p className="ag-callout__lead">{reasonLabel(first, asset, i18n)}</p>}
        {others.length > 0 && (
          // « + N autres » (sections.md §1.3): the main reason leads, the others stay one click away.
          <details className="ag-callout__more">
            <summary>{t.moreReasons({ count: others.length })}</summary>
            <ul className="ag-diag__reasons">
              {others.map((reason, index) => (
                <li key={`${reason}-${index}`}>{reasonLabel(reason, asset, i18n)}</li>
              ))}
            </ul>
          </details>
        )}
        {reasons.includes('UNKNOWN_PHYSICAL_STATE') && <p className="ag-diag__note ag-diag__note--unknown">{t.unknownNote}</p>}
        {hasUnrecognizedValue(asset) && <p className="ag-diag__note ag-diag__note--unknown">{t.unrecognizedNote}</p>}
        <p className="ag-diag__note">{t.diagnosticNote({ time: evaluated })}</p>
      </Callout>

      <div className="ag-cols">
        <div>
          <h3 className="ag-sec-title">
            {t.derivedFacts}
            <ReadOnlyMark />
          </h3>
          <dl className="ag-facts">
            <div>
              <dt>{t.factAvailability}</dt>
              <dd>
                <StatusChip role={availabilityRole(asset.availability)} icon="status-info">
                  {availabilityLabel(asset.availability, i18n)}
                </StatusChip>
              </dd>
            </div>
            <div>
              <dt>{t.factPresence}</dt>
              <dd>{presenceLabel(asset.presence, i18n)}</dd>
              {asset.presence === 'UNKNOWN' && <dd className="ag-help">{t.presenceUnknownHelp}</dd>}
            </div>
            <div>
              <dt>{t.factCalibration}</dt>
              <dd className={asset.calibration.status === 'EXPIRED' ? 'ag-facts__blocked' : undefined}>{calibrationLabel(asset, i18n)}</dd>
            </div>
            <div>
              <dt>{t.factPlacement}</dt>
              <dd className="ag-tnum">{asset.placement ? `${asset.placement.lockerCode} · ${asset.placement.compartmentCode}` : t.noPlacement}</dd>
            </div>
            <div>
              <dt>{t.factSerialNumber}</dt>
              <dd className={asset.serialNumber ? 'ag-tnum' : undefined}>{asset.serialNumber ?? t.notProvided}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="ag-sec-title">
            {t.settings}
          </h3>
          <dl className="ag-facts">
            <div>
              <dt>{t.settingAccessLevel}</dt>
              <dd>{accessLevelLabel(asset.requiredAccessLevel, i18n)}</dd>
            </div>
            <div>
              <dt>{t.settingServiceState}</dt>
              <dd>{serviceStateLabel(asset.operationalStatus, i18n)}</dd>
            </div>
            <div>
              <dt>{t.settingCalibrationRequired}</dt>
              <dd>{asset.calibration.required ? t.yes : t.no}</dd>
            </div>
            <div>
              <dt>{t.settingCalibrationDue}</dt>
              <dd className="ag-tnum">{calibrationDueLabel(asset, i18n)}</dd>
              {asset.calibration.dueAt !== null && <dd className="ag-help">{t.zoneNote({ zone: LAB_TIME_ZONE })}</dd>}
            </div>
          </dl>
        </div>
      </div>
      <section className="ag-eq-history" aria-labelledby={`${titleId}-history`}>
        <h3 className="ag-sec-title" id={`${titleId}-history`}>
          {t.historyTitle}
        </h3>
        <ul className="ag-eq-history__links">
          <li>
            <Link className="ag-link" to={transactionHref({ view: 'loans', filters: { ...NO_TRANSACTION_FILTERS, assetId: asset.id } })}>
              {t.historyLoans}
            </Link>
          </li>
          <li>
            <Link className="ag-link" to={transactionHref({ view: 'reservations', filters: { ...NO_TRANSACTION_FILTERS, assetId: asset.id } })}>
              {t.historyReservations}
            </Link>
          </li>
          <li>
            <Link className="ag-link" to={transactionHref({ view: 'operations', filters: { ...NO_TRANSACTION_FILTERS, assetId: asset.id } })}>
              {t.historyOperations}
            </Link>
          </li>
          <li>
            <Link className="ag-link" to={auditHref({ ...NO_AUDIT_FILTERS, subjectType: 'ASSET', subjectId: asset.id })}>
              {t.historyAudit}
            </Link>
          </li>
        </ul>
        <p className="ag-help">{t.historyAuditNote}</p>
      </section>
      {custody}
    </>
  )
}
