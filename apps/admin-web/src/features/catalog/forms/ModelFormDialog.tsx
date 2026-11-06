import { useRef, useState, type FormEvent } from 'react'
import { useIdempotencyKey } from '../../../api/idempotency'
import { useI18n } from '../../../i18n/useI18n'
import { Button } from '../../../ui/Button'
import { CheckboxField, TextAreaField, TextField } from '../../../ui/FormField'
import { Dialog, DialogActions, DialogBody } from '../../../ui/Dialog'
import type { AssetModelRequest, AssetModelView } from '../contract'
import { classifyMutationFailure } from '../mutationFailure'
import { useCatalogMutations } from '../useCatalogMutations'
import { FormAlert } from './FormAlert'
import { feedbackFor, LIMITS, type FormFeedback } from './formFeedback'
import { useFeedbackFocus } from './useFeedbackFocus'

interface ModelFormDialogProps {
  readonly open: boolean
  /** Null creates a model; otherwise its fields are edited (09 §12.1, PUT). */
  readonly model: AssetModelView | null
  readonly onClose: () => void
  readonly onSaved: (model: AssetModelView, created: boolean) => void
}

const FIELDS = { name: LIMITS.modelName, manufacturer: LIMITS.manufacturer, modelNumber: LIMITS.modelNumber, description: LIMITS.description, defaultCalibrationRequired: undefined }

interface Draft {
  readonly name: string
  readonly manufacturer: string
  readonly modelNumber: string
  readonly description: string
  readonly defaultCalibrationRequired: boolean
}

function draftOf(model: AssetModelView | null): Draft {
  return {
    name: model?.name ?? '',
    manufacturer: model?.manufacturer ?? '',
    modelNumber: model?.modelNumber ?? '',
    description: model?.description ?? '',
    defaultCalibrationRequired: model?.defaultCalibrationRequired ?? false,
  }
}

/** Every key is sent; an empty optional text is `null` (the server trims and does the same). */
function requestOf(draft: Draft): AssetModelRequest {
  const optional = (value: string) => (value.trim() === '' ? null : value.trim())
  return {
    name: draft.name.trim(),
    manufacturer: optional(draft.manufacturer),
    modelNumber: optional(draft.modelNumber),
    description: optional(draft.description),
    defaultCalibrationRequired: draft.defaultCalibrationRequired,
  }
}

/** Anticipates the contract's single-field rules, so an obvious mistake needs no request. */
function localErrors(request: AssetModelRequest, i18n: ReturnType<typeof useI18n>): Record<string, string> {
  const v = i18n.m.catalogEdit.violation
  const errors: Record<string, string> = {}
  if (request.name === '') errors.name = v.required
  else if (request.name.length > LIMITS.modelName) errors.name = v.tooLong({ max: LIMITS.modelName })
  for (const field of ['manufacturer', 'modelNumber', 'description'] as const) {
    const value = request[field]
    if (value !== null && value.length > LIMITS[field]) errors[field] = v.tooLong({ max: LIMITS[field] })
  }
  return errors
}

/** Create or edit an asset model (CAT-01). Proposed form: awaits visual approval (docs/design/manager-forms/). */
// Mount one instance per opening (a new `key`): the draft, the idempotency key and the mutation then start fresh.
export function ModelFormDialog({ open, model, onClose, onSaved }: ModelFormDialogProps) {
  const i18n = useI18n()
  const t = i18n.m.catalogEdit
  const { createModel, updateModel } = useCatalogMutations()
  const idempotency = useIdempotencyKey()
  const [draft, setDraft] = useState<Draft>(() => draftOf(model))
  const [feedback, setFeedback] = useState<FormFeedback>({ fieldErrors: {}, alert: null })
  const alertRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const mutation = model === null ? createModel : updateModel
  const busy = mutation.isPending

  useFeedbackFocus(feedback, alertRef, formRef)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const request = requestOf(draft)
    const errors = localErrors(request, i18n)
    if (Object.keys(errors).length > 0) {
      setFeedback({ fieldErrors: errors, alert: null })
      return
    }
    setFeedback({ fieldErrors: {}, alert: null })
    try {
      const saved =
        model === null
          ? await createModel.mutateAsync({ request, idempotencyKey: idempotency.keyFor(request) })
          : await updateModel.mutateAsync({ modelId: model.id, request })
      onSaved(saved, model === null)
    } catch (error) {
      setFeedback(feedbackFor(classifyMutationFailure(error), FIELDS, i18n))
    }
  }

  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const error = (field: string) => feedback.fieldErrors[field] ?? null

  return (
    <Dialog open={open} title={model === null ? t.createModelTitle : t.editModelTitle({ name: model.name })} onClose={onClose} busy={busy}>
      <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="ag-dialog__form">
        <DialogBody>
          {feedback.alert !== null && <FormAlert content={feedback.alert} focusRef={alertRef} />}
          <TextField
            label={t.fieldModelName}
            value={draft.name}
            onChange={(event) => set('name')(event.target.value)}
            error={error('name')}
            autoComplete="off"
            required
            readOnly={busy}
            data-autofocus=""
          />
          <div className="ag-ff-row">
            <TextField
              label={t.fieldManufacturer}
              optional={t.optional}
              value={draft.manufacturer}
              onChange={(event) => set('manufacturer')(event.target.value)}
              error={error('manufacturer')}
              autoComplete="off"
              readOnly={busy}
            />
            <TextField
              label={t.fieldModelNumber}
              optional={t.optional}
              value={draft.modelNumber}
              onChange={(event) => set('modelNumber')(event.target.value)}
              error={error('modelNumber')}
              autoComplete="off"
              readOnly={busy}
            />
          </div>
          <TextAreaField
            label={t.fieldDescription}
            optional={t.optional}
            value={draft.description}
            onChange={(event) => set('description')(event.target.value)}
            error={error('description')}
            rows={3}
            readOnly={busy}
          />
          <CheckboxField
            label={t.fieldDefaultCalibration}
            help={t.fieldDefaultCalibrationHelp}
            checked={draft.defaultCalibrationRequired}
            onChange={(event) => !busy && set('defaultCalibrationRequired')(event.target.checked)}
            error={error('defaultCalibrationRequired')}
          />
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" onClick={() => !busy && onClose()} inert={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {feedback.alert?.retryable ? t.retry : model === null ? t.create : t.save}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
