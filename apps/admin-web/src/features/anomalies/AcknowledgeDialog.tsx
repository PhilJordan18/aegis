import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react'
import { useIdempotencyKey } from '../../api/idempotency'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { Dialog, DialogActions, DialogBody } from '../../ui/Dialog'
import { TextAreaField } from '../../ui/FormField'
import { classifyAcknowledgeFailure } from './anomalyFailure'
import { anomalyTypeLabel, statusText, whereLine } from './anomalyPresentation'
import type { AnomalyDetail, AnomalyView } from './contract'
import { countGraphemes, isBlank, NOTE_MAX } from './noteLength'
import { useAcknowledgeAnomaly } from './useAnomalyMutations'

export type RefusalReason = 'alreadyResolved' | 'notAcknowledgeable'

interface AcknowledgeDialogProps {
  readonly open: boolean
  readonly anomaly: AnomalyView
  readonly onClose: () => void
  /** The server accepted the acknowledgement; its answer is already in the cache. */
  readonly onAcknowledged: () => void
  /** The server refused with a 409: the page shows the dossier as re-read, and says why. */
  readonly onRefused: (reason: RefusalReason) => void
}

type FieldError = 'empty' | 'tooLong' | 'refused'

interface AlertContent {
  readonly title: string
  readonly body: string
  readonly traceId: string | null
  readonly retryable: boolean
}

type Outcome =
  | { readonly kind: 'field'; readonly error: FieldError }
  | { readonly kind: 'alert'; readonly content: AlertContent }
  /** 409: nothing was recorded. `server` is the dossier as re-read, null when that read failed. */
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly server: AnomalyDetail | null }

type Phase = 'idle' | 'saving' | 'rereading'

/**
 * The acknowledgement dialog (09 §18.2): a required note, one `Idempotency-Key` for one intent (the same note is
 * the same intent, so a retry after a lost answer reuses it), and no local verdict: success shows the server's
 * answer, a 409 keeps the typed note read-only while the dossier is read again, then says what the server holds.
 * Mount one instance per opening (a new `key`): the note and the key then start fresh.
 */
export function AcknowledgeDialog({ open, anomaly, onClose, onAcknowledged, onRefused }: AcknowledgeDialogProps) {
  const i18n = useI18n()
  const t = i18n.m.anomalies
  const d = t.dialog
  const { acknowledge, rereadAfterRefusal } = useAcknowledgeAnomaly()
  const idempotency = useIdempotencyKey()
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const busy = phase !== 'idle'
  const refused = outcome?.kind === 'refused'
  const locked = busy || refused
  const graphemes = countGraphemes(note, i18n.locale)

  // Once the feedback is rendered, not in an animation frame that may run before it exists.
  useEffect(() => {
    if (outcome === null) return
    if (outcome.kind === 'field') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    else alertRef.current?.focus()
  }, [outcome])

  async function reread(reason: RefusalReason) {
    setPhase('rereading')
    try {
      const server = await rereadAfterRefusal(anomaly.id)
      setOutcome({ kind: 'refused', reason, server })
    } catch {
      setOutcome({ kind: 'refused', reason, server: null })
    }
    setPhase('idle')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || refused) return
    if (isBlank(note)) {
      setOutcome({ kind: 'field', error: 'empty' })
      return
    }
    setOutcome(null)
    setPhase('saving')
    try {
      await acknowledge.mutateAsync({ anomalyId: anomaly.id, note, idempotencyKey: idempotency.keyFor({ anomalyId: anomaly.id, note }) })
      setPhase('idle')
      onAcknowledged()
    } catch (error) {
      const failure = classifyAcknowledgeFailure(error)
      switch (failure.kind) {
        case 'alreadyResolved':
        case 'notAcknowledgeable': {
          const reason: RefusalReason = failure.kind
          onRefused(reason)
          await reread(reason)
          return
        }
        case 'invalidNote':
          setOutcome({ kind: 'field', error: failure.violations.includes('NOT_BLANK') ? 'empty' : failure.violations.includes('SIZE') ? 'tooLong' : 'refused' })
          break
        case 'ended':
          break
        case 'unreachable':
          setOutcome({ kind: 'alert', content: { title: d.unreachableTitle, body: d.unreachableBody, traceId: null, retryable: true } })
          break
        case 'inProgress':
          setOutcome({ kind: 'alert', content: { title: d.inProgressTitle, body: d.inProgressBody, traceId: null, retryable: true } })
          break
        case 'serviceError':
          setOutcome({ kind: 'alert', content: { title: d.serviceErrorTitle, body: d.serviceErrorBody, traceId: failure.traceId, retryable: true } })
          break
        case 'forbidden':
          setOutcome({ kind: 'alert', content: { title: d.forbiddenTitle, body: d.forbiddenBody, traceId: null, retryable: false } })
          break
        case 'notFound':
          setOutcome({ kind: 'alert', content: { title: d.notFoundTitle, body: d.notFoundBody, traceId: null, retryable: false } })
          void rereadAfterRefusal(anomaly.id).catch(() => undefined)
          break
      }
      setPhase('idle')
    }
  }

  const fieldError = outcome?.kind === 'field' ? { empty: d.errorEmpty, tooLong: d.errorTooLong, refused: d.errorRefused }[outcome.error] : null
  const retryable = outcome?.kind === 'alert' && outcome.content.retryable
  const finished = refused || (outcome?.kind === 'alert' && !outcome.content.retryable)

  return (
    <Dialog
      open={open}
      title={d.title}
      description={
        <>
          <p>
            {anomalyTypeLabel(anomaly, i18n)} · {whereLine(anomaly, i18n)}
          </p>
          <p>{d.description}</p>
        </>
      }
      onClose={onClose}
      busy={busy}
    >
      <form ref={formRef} noValidate className="ag-dialog__form" onSubmit={(event) => void submit(event)}>
        <DialogBody>
          <div className="ag-sr-only" role="status">
            {phase === 'saving' ? d.saving : phase === 'rereading' ? d.rereading : ''}
          </div>
          {outcome?.kind === 'alert' && (
            <div className="ag-dialog__alert" ref={alertRef} tabIndex={-1}>
              <Alert kind={outcome.content.retryable ? 'warning' : 'error'} icon={outcome.content.retryable ? 'status-offline' : 'status-error'} title={outcome.content.title} code={outcome.content.traceId ?? undefined} codeLabel={t.traceIdLabel}>
                <p>{outcome.content.body}</p>
              </Alert>
            </div>
          )}
          {outcome?.kind === 'refused' && <RefusalAlert outcome={outcome} alertRef={alertRef} />}
          <TextAreaField
            label={d.noteLabel}
            help={d.noteHelp}
            error={fieldError}
            counter={graphemes > NOTE_MAX ? d.counterOver({ count: graphemes }) : d.counter({ count: graphemes })}
            value={note}
            rows={4}
            readOnly={locked}
            data-autofocus=""
            onChange={(event) => setNote(event.target.value)}
          />
        </DialogBody>
        <DialogActions>
          <Button variant="secondary" onClick={() => !busy && onClose()} inert={busy}>
            {finished ? d.close : d.cancel}
          </Button>
          {refused && outcome.server === null && (
            <Button variant="secondary" busy={phase === 'rereading'} onClick={() => phase === 'idle' && void reread(outcome.reason)}>
              {d.rereadRetry}
            </Button>
          )}
          {!finished && (
            <Button type="submit" busy={busy}>
              {retryable ? t.retry : d.submit}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}

function RefusalAlert({ outcome, alertRef }: { readonly outcome: Extract<Outcome, { kind: 'refused' }>; readonly alertRef: Ref<HTMLDivElement> }) {
  const i18n = useI18n()
  const d = i18n.m.anomalies.dialog
  const resolved = outcome.reason === 'alreadyResolved'
  return (
    <div className="ag-dialog__alert" ref={alertRef} tabIndex={-1}>
      <Alert kind={resolved ? 'error' : 'warning'} icon={resolved ? 'status-error' : 'status-info'} title={resolved ? d.resolvedTitle : d.notAcknowledgeableTitle}>
        <p>{resolved ? d.resolvedBody : d.notAcknowledgeableBody}</p>
        <p>{outcome.server === null ? d.rereadFailed : d.serverState({ state: statusText(outcome.server.status, i18n) })}</p>
      </Alert>
    </div>
  )
}
