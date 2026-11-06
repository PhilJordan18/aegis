import { useRef, useState, type FormEvent } from 'react'
import { useIdempotencyKey } from '../../api/idempotency'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Dialog, DialogActions, DialogBody } from '../../ui/Dialog'
import { SelectField, TextField } from '../../ui/FormField'
import { FormAlert } from '../catalog/forms/FormAlert'
import { feedbackFor, LIMITS, type FormFeedback } from '../catalog/forms/formFeedback'
import { useFeedbackFocus } from '../catalog/forms/useFeedbackFocus'
import { classifyMutationFailure } from '../catalog/mutationFailure'
import { IDENTIFIER_TYPES, type AssetIdentifierView, type AssignIdentifierRequest, type IdentifierType } from './contract'

interface AssignIdentifierDialogProps {
  readonly open: boolean
  readonly assetCode: string
  readonly assign: (request: AssignIdentifierRequest, idempotencyKey: string) => Promise<AssetIdentifierView>
  readonly busy: boolean
  readonly onClose: () => void
  readonly onAssigned: (identifier: AssetIdentifierView) => void
}

const FIELDS = { type: undefined, value: LIMITS.identifierValue }

/**
 * Assigns an identifier (CAT-02 #26, 09 §12.3) with one Idempotency-Key per intent. The value is sent trimmed and
 * otherwise as typed: the server compares it as is. Proposed form: awaits visual approval (docs/design/manager-forms/).
 * Mount one instance per opening (`key`).
 */
export function AssignIdentifierDialog({ open, assetCode, assign, busy, onClose, onAssigned }: AssignIdentifierDialogProps) {
  const i18n = useI18n()
  const t = i18n.m.custody
  const c = i18n.m.catalogEdit
  const idempotency = useIdempotencyKey()
  const [type, setType] = useState<IdentifierType>('RFID_UHF')
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<FormFeedback>({ fieldErrors: {}, alert: null })
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  useFeedbackFocus(feedback, alertRef, formRef)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const request = { type, value: value.trim() }
    if (request.value === '') return setFeedback({ fieldErrors: { value: c.violation.required }, alert: null })
    if (request.value.length > LIMITS.identifierValue) return setFeedback({ fieldErrors: { value: c.violation.tooLong({ max: LIMITS.identifierValue }) }, alert: null })
    setFeedback({ fieldErrors: {}, alert: null })
    try {
      onAssigned(await assign(request, idempotency.keyFor(request)))
    } catch (error) {
      setFeedback(feedbackFor(classifyMutationFailure(error), FIELDS, i18n))
    }
  }

  const error = (field: string) => feedback.fieldErrors[field] ?? null

  return (
    <Dialog open={open} title={t.assignTitle({ code: assetCode })} description={<p>{t.assignDescription}</p>} onClose={onClose} busy={busy}>
      <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="ag-dialog__form">
        <DialogBody>
          {feedback.alert !== null && <FormAlert content={feedback.alert} focusRef={alertRef} />}
          <SelectField label={t.fieldType} value={type} onChange={(event) => !busy && setType(event.target.value as IdentifierType)} error={error('type')} data-autofocus="">
            {IDENTIFIER_TYPES.map((option) => (
              <option key={option} value={option}>
                {t.type[option]}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t.fieldValue}
            help={t.fieldValueHelp}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={error('value')}
            autoComplete="off"
            spellCheck={false}
            required
            readOnly={busy}
          />
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" onClick={() => !busy && onClose()} inert={busy}>
            {c.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {feedback.alert?.retryable ? c.retry : t.assign}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
