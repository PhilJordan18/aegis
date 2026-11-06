import { useEffect, useRef, useState } from 'react'
import { useIdempotencyKey } from '../../../api/idempotency'
import { useI18n } from '../../../i18n/useI18n'
import { Button } from '../../../ui/Button'
import { Dialog, DialogActions, DialogBody } from '../../../ui/Dialog'
import { classifyMutationFailure } from '../mutationFailure'
import { FormAlert } from './FormAlert'
import { feedbackFor, type FormAlertContent } from './formFeedback'

interface ArchiveDialogProps<T> {
  readonly open: boolean
  readonly title: string
  /** What archiving does, then the server's guard: the confirmation never promises that it will be accepted. */
  readonly consequence: string
  readonly guard: string
  /** Runs the archive command with one key for this confirmation (09 §20.1); a retry reuses it. */
  readonly archive: (idempotencyKey: string) => Promise<T>
  readonly onClose: () => void
  readonly onArchived: (result: T) => void
}

/** Confirmation of an archive (model or unit). `alertdialog`: focus starts on the safe choice, Cancel. */
// Mount one instance per opening (a new `key`): the draft, the idempotency key and the mutation then start fresh.
export function ArchiveDialog<T>({ open, title, consequence, guard, archive, onClose, onArchived }: ArchiveDialogProps<T>) {
  const i18n = useI18n()
  const t = i18n.m.catalogEdit
  const idempotency = useIdempotencyKey()
  const [busy, setBusy] = useState(false)
  const [alert, setAlert] = useState<FormAlertContent | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  // Once the refusal is rendered, not in an animation frame that may run before it exists.
  useEffect(() => {
    if (alert !== null) alertRef.current?.focus()
  }, [alert])

  async function confirm() {
    if (busy) return
    setBusy(true)
    setAlert(null)
    try {
      const result = await archive(idempotency.keyFor('archive'))
      setBusy(false)
      onArchived(result)
    } catch (error) {
      setBusy(false)
      const next = feedbackFor(classifyMutationFailure(error), {}, i18n).alert
      setAlert(next)
    }
  }

  return (
    <Dialog
      open={open}
      role="alertdialog"
      size="sm"
      title={title}
      description={
        <>
          <p>{consequence}</p>
          <p>{guard}</p>
        </>
      }
      onClose={onClose}
      busy={busy}
    >
      {alert !== null && (
        <DialogBody>
          <FormAlert content={alert} focusRef={alertRef} />
        </DialogBody>
      )}
      <DialogActions>
        <Button variant="secondary" onClick={() => !busy && onClose()} inert={busy} data-autofocus="">
          {t.cancel}
        </Button>
        <Button onClick={() => void confirm()} busy={busy} inert={alert !== null && !alert.retryable}>
          {alert?.retryable ? t.retry : t.archive}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
