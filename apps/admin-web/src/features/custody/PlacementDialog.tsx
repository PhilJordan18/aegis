import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Dialog, DialogActions, DialogBody } from '../../ui/Dialog'
import { SelectField, TextAreaField } from '../../ui/FormField'
import type { PlacementSummary } from '../catalog/contract'
import { FormAlert } from '../catalog/forms/FormAlert'
import { feedbackFor, LIMITS, type FormFeedback } from '../catalog/forms/formFeedback'
import { useFeedbackFocus } from '../catalog/forms/useFeedbackFocus'
import { classifyMutationFailure } from '../catalog/mutationFailure'
import type { AdminCompartmentView, AdminLockerView, AssetPlacementView, PlacementRequest } from './contract'
import { useAdminLockers } from './useCustody'

interface PlacementDialogProps {
  readonly open: boolean
  readonly assetId: string
  readonly assetCode: string
  readonly current: PlacementSummary | null
  readonly place: (request: PlacementRequest) => Promise<AssetPlacementView>
  readonly busy: boolean
  readonly onClose: () => void
  readonly onPlaced: (placement: AssetPlacementView) => void
}

const FIELDS = { compartmentId: undefined, reason: LIMITS.placementReason }

/**
 * Sets the expected placement of a unit (CAT-02 #26, 09 §12.4) from the locker list (§16.2), read at each opening.
 * Occupancy and disabled cells are shown as read, never enforced here: the server judges the compartment when saving.
 * Form direction approved for P0 on 6 November 2026 (docs/design/manager-forms/README.md). Mount one instance per opening (`key`).
 */
export function PlacementDialog({ open, assetId, assetCode, current, place, busy, onClose, onPlaced }: PlacementDialogProps) {
  const i18n = useI18n()
  const t = i18n.m.custody
  const lockers = useAdminLockers({ enabled: open })
  // Only a list read after this opening is offered; the refresh that follows a save does not take the form away.
  const [openedAt] = useState(() => Date.now())
  const loaded = lockers.isSuccess && lockers.dataUpdatedAt >= openedAt

  return (
    <Dialog open={open} title={t.placementDialogTitle({ code: assetCode })} description={<p>{t.placementDescription}</p>} onClose={onClose} busy={busy}>
      {!loaded ? (
        <>
          <DialogBody>
            <p role="status">{lockers.isError ? t.lockersUnavailable : t.lockersLoading}</p>
          </DialogBody>
          {lockers.isError && (
            <DialogActions>
              <Button variant="secondary" onClick={onClose}>
                {i18n.m.catalogEdit.cancel}
              </Button>
              <Button onClick={() => void lockers.refetch()}>{i18n.m.catalogEdit.retry}</Button>
            </DialogActions>
          )}
        </>
      ) : (
        <PlacementForm lockers={lockers.data.items} assetId={assetId} current={current} place={place} busy={busy} onCancel={onClose} onPlaced={onPlaced} />
      )}
    </Dialog>
  )
}

interface PlacementFormProps {
  readonly lockers: readonly AdminLockerView[]
  readonly assetId: string
  readonly current: PlacementSummary | null
  readonly place: (request: PlacementRequest) => Promise<AssetPlacementView>
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onPlaced: (placement: AssetPlacementView) => void
}

function PlacementForm({ lockers, assetId, current, place, busy, onCancel, onPlaced }: PlacementFormProps) {
  const i18n = useI18n()
  const t = i18n.m.custody
  const c = i18n.m.catalogEdit
  const initialLocker = current?.lockerId ?? (lockers.length === 1 ? lockers[0]!.id : '')
  const [lockerId, setLockerId] = useState(initialLocker)
  const [compartmentId, setCompartmentId] = useState(current?.compartmentId ?? '')
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState<FormFeedback>({ fieldErrors: {}, alert: null })
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const locker = lockers.find((candidate) => candidate.id === lockerId)

  // The form appears after the read, once the dialog holds focus: its first field then takes it.
  useEffect(() => {
    const form = formRef.current
    const active = document.activeElement
    if (form === null || (active !== null && active !== document.body && active !== form.closest('dialog'))) return
    form.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)')?.focus()
  }, [])

  useFeedbackFocus(feedback, alertRef, formRef)

  function optionLabel(compartment: AdminCompartmentView): string {
    if (!compartment.enabled) return t.compartmentDisabled({ code: compartment.code })
    if (compartment.currentAsset === null) return t.compartmentFree({ code: compartment.code })
    if (compartment.currentAsset.id === assetId) return t.compartmentCurrent({ code: compartment.code })
    return t.compartmentOccupied({ code: compartment.code, asset: compartment.currentAsset.assetCode })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const request = { compartmentId, reason: reason.trim() }
    const errors: Record<string, string> = {}
    if (lockerId === '') errors.lockerId = c.violation.required
    else if (compartmentId === '') errors.compartmentId = c.violation.required
    if (request.reason === '') errors.reason = c.violation.required
    else if (request.reason.length > LIMITS.placementReason) errors.reason = c.violation.tooLong({ max: LIMITS.placementReason })
    if (Object.keys(errors).length > 0) return setFeedback({ fieldErrors: errors, alert: null })
    setFeedback({ fieldErrors: {}, alert: null })
    try {
      onPlaced(await place(request))
    } catch (error) {
      setFeedback(feedbackFor(classifyMutationFailure(error), FIELDS, i18n))
    }
  }

  const error = (field: string) => feedback.fieldErrors[field] ?? null

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="ag-dialog__form">
      <DialogBody>
        {feedback.alert !== null && <FormAlert content={feedback.alert} focusRef={alertRef} />}
        {lockers.length === 0 ? (
          <p>{t.noLocker}</p>
        ) : (
          <div className="ag-ff-row">
            <SelectField
              label={t.fieldLocker}
              value={lockerId}
              onChange={(event) => {
                if (busy) return
                setLockerId(event.target.value)
                setCompartmentId('')
              }}
              error={error('lockerId')}
              required
              data-autofocus=""
            >
              <option value="">{t.chooseLocker}</option>
              {lockers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name === '' ? option.code : `${option.code} · ${option.name}`}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t.fieldCompartment}
              value={compartmentId}
              onChange={(event) => !busy && setCompartmentId(event.target.value)}
              error={error('compartmentId')}
              disabled={locker === undefined}
              required
            >
              <option value="">{t.chooseCompartment}</option>
              {(locker?.compartments ?? []).map((compartment) => (
                <option key={compartment.id} value={compartment.id}>
                  {optionLabel(compartment)}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <TextAreaField label={t.fieldReason} help={t.fieldReasonHelp} value={reason} onChange={(event) => setReason(event.target.value)} error={error('reason')} rows={2} required readOnly={busy} />
      </DialogBody>
      <DialogActions>
        <Button variant="secondary" onClick={() => !busy && onCancel()} inert={busy}>
          {c.cancel}
        </Button>
        <Button type="submit" busy={busy} inert={lockers.length === 0}>
          {feedback.alert?.retryable ? c.retry : c.save}
        </Button>
      </DialogActions>
    </form>
  )
}
