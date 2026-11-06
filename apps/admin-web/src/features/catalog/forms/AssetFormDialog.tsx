import { useRef, useState, type FormEvent } from 'react'
import { useIdempotencyKey } from '../../../api/idempotency'
import { instantToZonedInput, zonedInputToInstant } from '../../../i18n/zonedTime'
import { useI18n } from '../../../i18n/useI18n'
import type { AccessLevel } from '../../auth/contract'
import { Button } from '../../../ui/Button'
import { CheckboxField, ChoiceField, SelectField, TextField } from '../../../ui/FormField'
import { Dialog, DialogActions, DialogBody } from '../../../ui/Dialog'
import { LAB_TIME_ZONE } from '../assetPresentation'
import { MAX_PAGE_SIZE, type AdminAssetView, type AssetModelView, type AssetRequest, type OperationalStatus } from '../contract'
import { classifyMutationFailure } from '../mutationFailure'
import { useCatalogMutations } from '../useCatalogMutations'
import { useModelList } from '../useCatalogQueries'
import { FormAlert } from './FormAlert'
import { feedbackFor, LIMITS, type FormFeedback } from './formFeedback'

interface AssetFormDialogProps {
  readonly open: boolean
  /** Null creates a unit; otherwise its editable fields are replaced (09 §12.2, PUT). */
  readonly asset: AdminAssetView | null
  readonly onClose: () => void
  readonly onSaved: (asset: AdminAssetView, created: boolean) => void
}

const FIELDS = {
  assetModelId: undefined,
  assetCode: LIMITS.assetCode,
  serialNumber: LIMITS.serialNumber,
  requiredAccessLevel: undefined,
  operationalStatus: undefined,
  calibrationRequired: undefined,
  calibrationDueAt: undefined,
}

const ACCESS_LEVELS: readonly AccessLevel[] = ['STANDARD', 'RESTRICTED']
const SERVICE_STATES: readonly OperationalStatus[] = ['SERVICEABLE', 'MAINTENANCE', 'DAMAGED']
const MODEL_QUERY = { page: 0, size: MAX_PAGE_SIZE } as const

interface Draft {
  readonly assetModelId: string
  readonly assetCode: string
  readonly serialNumber: string
  readonly requiredAccessLevel: AccessLevel | ''
  readonly operationalStatus: OperationalStatus | ''
  readonly calibrationRequired: boolean
  /** `datetime-local` value in the laboratory zone. */
  readonly calibrationDue: string
}

function draftOf(asset: AdminAssetView | null): Draft {
  const known = <T extends string>(value: string, allowed: readonly T[]): T | '' => ((allowed as readonly string[]).includes(value) ? (value as T) : '')
  return {
    assetModelId: asset?.model.id ?? '',
    assetCode: asset?.assetCode ?? '',
    serialNumber: asset?.serialNumber ?? '',
    requiredAccessLevel: asset === null ? 'STANDARD' : known(asset.requiredAccessLevel, ACCESS_LEVELS),
    operationalStatus: asset === null ? 'SERVICEABLE' : known(asset.operationalStatus, SERVICE_STATES),
    calibrationRequired: asset?.calibration.required ?? false,
    calibrationDue: asset?.calibration.dueAt ? (instantToZonedInput(asset.calibration.dueAt, LAB_TIME_ZONE) ?? '') : '',
  }
}

/** Anticipates single-field rules and the calibration pair; the server stays the authority (09 §12.2). */
function validate(draft: Draft, original: AdminAssetView | null, i18n: ReturnType<typeof useI18n>): { request: AssetRequest | null; errors: Record<string, string> } {
  const v = i18n.m.catalogEdit.violation
  const errors: Record<string, string> = {}
  const assetCode = draft.assetCode.trim()
  const serialNumber = draft.serialNumber.trim()
  if (draft.assetModelId === '') errors.assetModelId = v.chooseModel
  if (assetCode === '') errors.assetCode = v.required
  else if (assetCode.length > LIMITS.assetCode) errors.assetCode = v.tooLong({ max: LIMITS.assetCode })
  if (serialNumber.length > LIMITS.serialNumber) errors.serialNumber = v.tooLong({ max: LIMITS.serialNumber })
  if (draft.requiredAccessLevel === '') errors.requiredAccessLevel = v.required
  if (draft.operationalStatus === '') errors.operationalStatus = v.required

  let calibrationDueAt: string | null = null
  if (draft.calibrationRequired) {
    // An untouched value keeps the server's exact instant (seconds included): editing other fields changes nothing here.
    const originalDue = original?.calibration.dueAt ?? null
    const unchanged = originalDue !== null && instantToZonedInput(originalDue, LAB_TIME_ZONE) === draft.calibrationDue
    calibrationDueAt = unchanged ? originalDue : zonedInputToInstant(draft.calibrationDue, LAB_TIME_ZONE)
    if (draft.calibrationDue === '') errors.calibrationDueAt = v.calibrationDueRequired
    else if (calibrationDueAt === null) errors.calibrationDueAt = v.invalid
  }
  if (Object.keys(errors).length > 0 || draft.requiredAccessLevel === '' || draft.operationalStatus === '') return { request: null, errors }
  return {
    request: {
      assetModelId: draft.assetModelId,
      assetCode,
      serialNumber: serialNumber === '' ? null : serialNumber,
      requiredAccessLevel: draft.requiredAccessLevel,
      operationalStatus: draft.operationalStatus,
      calibrationRequired: draft.calibrationRequired,
      calibrationDueAt,
    },
    errors,
  }
}

/**
 * Create or edit a unit (CAT-01). Readiness, availability and presence are never fields. Proposed form:
 * awaits visual approval (docs/design/manager-forms/).
 */
// Mount one instance per opening (a new `key`): the draft, the idempotency key and the mutation then start fresh.
export function AssetFormDialog({ open, asset, onClose, onSaved }: AssetFormDialogProps) {
  const i18n = useI18n()
  const t = i18n.m.catalogEdit
  const e = i18n.m.equipment
  const { createAsset, updateAsset } = useCatalogMutations()
  const models = useModelList(MODEL_QUERY, { enabled: open })
  const idempotency = useIdempotencyKey()
  const [draft, setDraft] = useState<Draft>(() => draftOf(asset))
  const calibrationTouched = useRef(asset !== null)
  const [feedback, setFeedback] = useState<FormFeedback>({ fieldErrors: {}, alert: null })
  const alertRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const busy = (asset === null ? createAsset : updateAsset).isPending


  function show(next: FormFeedback) {
    setFeedback(next)
    requestAnimationFrame(() => {
      if (next.alert !== null) alertRef.current?.focus()
      else formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const { request, errors } = validate(draft, asset, i18n)
    if (request === null) {
      show({ fieldErrors: errors, alert: null })
      return
    }
    setFeedback({ fieldErrors: {}, alert: null })
    try {
      const saved =
        asset === null
          ? await createAsset.mutateAsync({ request, idempotencyKey: idempotency.keyFor(request) })
          : await updateAsset.mutateAsync({ assetId: asset.id, request })
      onSaved(saved, asset === null)
    } catch (error) {
      show(feedbackFor(classifyMutationFailure(error), FIELDS, i18n))
    }
  }

  function chooseModel(modelId: string) {
    const chosen = models.data?.items.find((model) => model.id === modelId)
    setDraft((current) => ({
      ...current,
      assetModelId: modelId,
      // The model's default is a suggestion for a new unit, until calibration is set by hand.
      calibrationRequired: !calibrationTouched.current && chosen !== undefined ? chosen.defaultCalibrationRequired : current.calibrationRequired,
    }))
  }

  const error = (field: string) => feedback.fieldErrors[field] ?? null
  // Active models, plus the unit's current model when it is archived, so the form never changes it silently.
  const options: readonly AssetModelView[] = (models.data?.items ?? []).filter((model) => model.archivedAt === null || model.id === asset?.model.id)
  const currentMissing = asset !== null && !options.some((model) => model.id === asset.model.id)
  const noActiveModel = models.isSuccess && options.length === 0 && asset === null

  return (
    <Dialog
      open={open}
      title={asset === null ? t.createAssetTitle : t.editAssetTitle({ code: asset.assetCode })}
      description={<p>{t.assetFormDescription}</p>}
      onClose={onClose}
      busy={busy}
    >
      <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="ag-dialog__form">
        <DialogBody>
          {feedback.alert !== null && <FormAlert content={feedback.alert} focusRef={alertRef} />}
          <SelectField
            label={t.fieldModel}
            value={draft.assetModelId}
            onChange={(event) => chooseModel(event.target.value)}
            error={error('assetModelId') ?? (models.isError ? t.modelsUnavailable : noActiveModel ? t.noActiveModel : null)}
            help={models.isPending ? t.modelsLoading : undefined}
            disabled={busy}
            required
            data-autofocus=""
          >
            <option value="">{t.chooseModel}</option>
            {currentMissing && <option value={asset.model.id}>{asset.model.name}</option>}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.archivedAt === null ? model.name : t.archivedModelOption({ name: model.name })}
              </option>
            ))}
          </SelectField>
          <div className="ag-ff-row">
            <TextField
              label={t.fieldAssetCode}
              help={t.fieldAssetCodeHelp}
              value={draft.assetCode}
              onChange={(event) => setDraft({ ...draft, assetCode: event.target.value })}
              error={error('assetCode')}
              autoComplete="off"
              spellCheck={false}
              required
              readOnly={busy}
            />
            <TextField
              label={t.fieldSerialNumber}
              optional={t.optional}
              value={draft.serialNumber}
              onChange={(event) => setDraft({ ...draft, serialNumber: event.target.value })}
              error={error('serialNumber')}
              autoComplete="off"
              spellCheck={false}
              readOnly={busy}
            />
          </div>
          <ChoiceField
            legend={t.fieldAccessLevel}
            name="requiredAccessLevel"
            value={draft.requiredAccessLevel}
            options={ACCESS_LEVELS.map((value) => ({ value, label: e.accessLevel[value] }))}
            onChange={(value) => setDraft({ ...draft, requiredAccessLevel: value })}
            error={error('requiredAccessLevel')}
            disabled={busy}
          />
          <ChoiceField
            legend={t.fieldServiceState}
            name="operationalStatus"
            value={draft.operationalStatus}
            options={SERVICE_STATES.map((value) => ({ value, label: e.serviceState[value] }))}
            onChange={(value) => setDraft({ ...draft, operationalStatus: value })}
            error={error('operationalStatus')}
            disabled={busy}
          />
          <CheckboxField
            label={t.fieldCalibrationRequired}
            checked={draft.calibrationRequired}
            onChange={(event) => {
              if (busy) return
              calibrationTouched.current = true
              setDraft({ ...draft, calibrationRequired: event.target.checked })
            }}
            error={error('calibrationRequired')}
          />
          {draft.calibrationRequired && (
            <TextField
              type="datetime-local"
              label={t.fieldCalibrationDue}
              help={t.fieldCalibrationDueHelp({ zone: LAB_TIME_ZONE })}
              value={draft.calibrationDue}
              onChange={(event) => setDraft({ ...draft, calibrationDue: event.target.value })}
              error={error('calibrationDueAt')}
              required
              readOnly={busy}
            />
          )}
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" onClick={() => !busy && onClose()} inert={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {feedback.alert?.retryable ? t.retry : asset === null ? t.create : t.save}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
