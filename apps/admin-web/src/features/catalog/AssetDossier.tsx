import { useId, type Ref } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Icon } from '../../ui/Icon'
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
}

/**
 * Read-only dossier of one unit (handoff §3.1). The reasons are the server's non-personal diagnostic
 * as sent: the page shows no readiness verdict, no « ready » and no invented presence or compartment.
 */
export function AssetDossier({ asset, loading, failure, stale, retrying, focusRef, onRetry, onBack }: AssetDossierProps) {
  const { m } = useI18n()
  const titleId = useId()
  const groupId = useId()
  const t = m.equipment

  if (asset === undefined) {
    return (
      <section className="ag-panel ag-dossier" aria-label={t.selectedOverline} aria-busy={loading || undefined}>
        {failure !== null ? (
          <div className="ag-dossier__alert">
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
          returnFocus={() => document.getElementById(groupId)?.focus()}
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
}

function DossierBody({ asset, titleId, stale, retrying, onRetry, returnFocus }: DossierBodyProps) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.equipment
  const reasons = asset.operationalDiagnostic.reasons
  const tone = diagnosticTone(reasons)
  const chip = diagnosticChip(asset, i18n)
  const evaluated = evaluatedAtLabel(asset, i18n)
  const model = [asset.model.manufacturer, asset.model.modelNumber].filter((part) => part !== null && part !== '').join(' ')
  const archived = archivedDateLabel(asset, i18n)

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

      <div className={`ag-diag ag-diag--${tone}`}>
        <p className="ag-overline">{t.diagnosticTitle}</p>
        <div className="ag-diag__row">
          <StatusChip role={chip.role} icon={chip.icon} size="lg">
            {chip.label}
          </StatusChip>
        </div>
        {reasons.length > 0 && (
          <ul className="ag-diag__reasons">
            {reasons.map((reason, index) => (
              <li key={`${reason}-${index}`}>{reasonLabel(reason, asset, i18n)}</li>
            ))}
          </ul>
        )}
        {reasons.includes('UNKNOWN_PHYSICAL_STATE') && <p className="ag-diag__note ag-diag__note--unknown">{t.unknownNote}</p>}
        {hasUnrecognizedValue(asset) && <p className="ag-diag__note ag-diag__note--unknown">{t.unrecognizedNote}</p>}
        <p className="ag-diag__note">{t.diagnosticNote({ time: evaluated })}</p>
      </div>

      <div className="ag-cols">
        <div>
          <h3 className="ag-overline ag-sec-title">
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
          <h3 className="ag-overline ag-sec-title">
            {t.settings}
            <ReadOnlyMark />
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
    </>
  )
}

function ReadOnlyMark() {
  const { m } = useI18n()
  return (
    <span className="ag-readonly">
      <Icon name="lock" />
      {m.equipment.readOnly}
    </span>
  )
}
