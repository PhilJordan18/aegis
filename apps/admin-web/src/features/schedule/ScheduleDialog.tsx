import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n, type I18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { CheckboxField, TextField } from '../../ui/FormField'
import { Dialog, DialogActions, DialogBody } from '../../ui/Dialog'
import { Alert } from '../../ui/Alert'
import { FormAlert } from '../catalog/forms/FormAlert'
import { feedbackFor, violationMessage, type FormFeedback } from '../catalog/forms/formFeedback'
import { useFeedbackFocus } from '../catalog/forms/useFeedbackFocus'
import { classifyMutationFailure } from '../catalog/mutationFailure'
import type { OperatingScheduleView } from './contract'
import { draftOf, fieldOf, requestOf, type LocalViolation, type ScheduleDraft } from './scheduleDraft'
import { useOperatingSchedule, useSaveSchedule } from './useSchedule'
import './schedule.css'

interface ScheduleDialogProps {
  readonly open: boolean
  readonly lockerId: string
  readonly lockerCode: string
  /** Proposed when no schedule exists yet; the administrator can change it before saving. */
  readonly suggestedZone: string
  readonly onClose: () => void
  readonly onSaved: (schedule: OperatingScheduleView) => void
}

function scheduleViolation(code: string, i18n: I18n): string {
  const v = i18n.m.schedule.violation
  switch (code) {
    case 'REQUIRED_WHEN_ENABLED':
      return v.requiredWhenOpen
    case 'NOT_ALLOWED_WHEN_DISABLED':
      return v.notAllowedWhenClosed
    case 'NOT_AFTER_OPENS_AT':
      return v.notAfterOpensAt
    case 'DUPLICATE_DAY_OF_WEEK':
      return v.duplicateDay
    case 'INVALID_VALUE':
      return v.invalid
    default:
      return violationMessage(code, undefined, i18n)
  }
}

function localMessage(violation: LocalViolation, i18n: I18n): string {
  return violation === 'required' ? i18n.m.schedule.violation.requiredWhenOpen : i18n.m.schedule.violation.notAfterOpensAt
}

/**
 * Seven-day operating schedule of one locker (CFG-02 #28, 09 §13), read from the server at each opening.
 * Proposed form: awaits visual approval (docs/design/manager-forms/). Mount one instance per opening (`key`).
 */
export function ScheduleDialog({ open, lockerId, lockerCode, suggestedZone, onClose, onSaved }: ScheduleDialogProps) {
  const i18n = useI18n()
  const t = i18n.m.schedule
  const schedule = useOperatingSchedule(lockerId, { enabled: open })
  const save = useSaveSchedule(lockerId)
  const loaded = schedule.isSuccess && !schedule.isFetching

  return (
    <Dialog open={open} title={t.title({ code: lockerCode })} description={<p>{t.description}</p>} onClose={onClose} busy={save.isPending}>
      {!loaded && !schedule.isError && (
        <DialogBody>
          <p role="status">{t.loading}</p>
        </DialogBody>
      )}
      {schedule.isError && (
        <>
          <DialogBody>
            <Alert kind="error" icon="status-error" title={t.loadErrorTitle}>
              {t.loadErrorBody}
            </Alert>
          </DialogBody>
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>
              {i18n.m.catalogEdit.cancel}
            </Button>
            <Button onClick={() => void schedule.refetch()} busy={schedule.isFetching}>
              {i18n.m.catalogEdit.retry}
            </Button>
          </DialogActions>
        </>
      )}
      {loaded && (
        <ScheduleForm
          initial={draftOf(schedule.data, suggestedZone)}
          configured={schedule.data !== null}
          busy={save.isPending}
          onCancel={onClose}
          onSubmit={(request) => save.mutateAsync(request)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  )
}

interface ScheduleFormProps {
  readonly initial: ScheduleDraft
  readonly configured: boolean
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSubmit: (request: ReturnType<typeof requestOf>['request']) => Promise<OperatingScheduleView>
  readonly onSaved: (schedule: OperatingScheduleView) => void
}

function ScheduleForm({ initial, configured, busy, onCancel, onSubmit, onSaved }: ScheduleFormProps) {
  const i18n = useI18n()
  const t = i18n.m.schedule
  const [draft, setDraft] = useState(initial)
  const [feedback, setFeedback] = useState<FormFeedback>({ fieldErrors: {}, alert: null })
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  // The form appears after the read, once the dialog already holds focus (or the retry button that held it is gone):
  // the zone field then takes it, as an autofocus would have at opening.
  useEffect(() => {
    const form = formRef.current
    const active = document.activeElement
    if (form === null || (active !== null && active !== document.body && active !== form.closest('dialog'))) return
    form.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  useFeedbackFocus(feedback, alertRef, formRef)

  function setDay(index: number, patch: Partial<ScheduleDraft['days'][number]>) {
    setDraft((current) => ({ ...current, days: current.days.map((day, at) => (at === index ? { ...day, ...patch } : day)) }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const { request, errors } = requestOf(draft)
    if (Object.keys(errors).length > 0) {
      setFeedback({ fieldErrors: Object.fromEntries(Object.entries(errors).map(([field, violation]) => [field, localMessage(violation, i18n)])), alert: null })
      return
    }
    setFeedback({ fieldErrors: {}, alert: null })
    try {
      onSaved(await onSubmit(request))
    } catch (error) {
      const failure = classifyMutationFailure(error)
      if (failure.kind !== 'validation') return setFeedback(feedbackFor(failure, {}, i18n))
      const known = new Set(['timeZone', ...draft.days.flatMap((_, index) => [fieldOf(index, 'opensAt'), fieldOf(index, 'closesAt')])])
      const fieldErrors: Record<string, string> = {}
      let other = false
      for (const { field, code } of failure.violations) {
        if (known.has(field)) fieldErrors[field] ??= scheduleViolation(code, i18n)
        else other = true
      }
      const alert = other || Object.keys(fieldErrors).length === 0
        ? { title: i18n.m.catalogEdit.validationOtherTitle, body: null, traceId: failure.traceId, retryable: false }
        : { title: i18n.m.catalogEdit.validationTitle, body: null, traceId: null, retryable: false }
      setFeedback({ fieldErrors, alert })
    }
  }

  const error = (field: string) => feedback.fieldErrors[field] ?? null

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="ag-dialog__form">
      <DialogBody>
        {feedback.alert !== null && <FormAlert content={feedback.alert} focusRef={alertRef} />}
        {!configured && <p className="ag-sched__note">{t.notConfigured}</p>}
        <TextField
          label={t.fieldTimeZone}
          help={t.fieldTimeZoneHelp}
          value={draft.timeZone}
          onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
          error={error('timeZone')}
          autoComplete="off"
          spellCheck={false}
          required
          readOnly={busy}
          data-autofocus=""
        />
        <div className="ag-sched">
          {draft.days.map((day, index) => {
            const name = t.day[day.dayOfWeek]
            return (
              <fieldset key={day.dayOfWeek} className="ag-sched__day" data-open={day.enabled || undefined}>
                <legend className="ag-sched__name">{name}</legend>
                <CheckboxField
                  label={t.open}
                  checked={day.enabled}
                  onChange={(event) => !busy && setDay(index, { enabled: event.target.checked })}
                />
                {day.enabled ? (
                  <div className="ag-sched__times">
                    <TextField
                      type="time"
                      step={day.opensAt.length > 5 ? 1 : 60}
                      label={t.opensAt}
                      value={day.opensAt}
                      onChange={(event) => setDay(index, { opensAt: event.target.value })}
                      error={error(fieldOf(index, 'opensAt'))}
                      required
                      readOnly={busy}
                    />
                    <TextField
                      type="time"
                      step={day.closesAt.length > 5 ? 1 : 60}
                      label={t.closesAt}
                      value={day.closesAt}
                      onChange={(event) => setDay(index, { closesAt: event.target.value })}
                      error={error(fieldOf(index, 'closesAt'))}
                      required
                      readOnly={busy}
                    />
                  </div>
                ) : (
                  <p className="ag-sched__closed">{t.closed}</p>
                )}
              </fieldset>
            )
          })}
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="secondary" onClick={() => !busy && onCancel()} inert={busy}>
          {i18n.m.catalogEdit.cancel}
        </Button>
        <Button type="submit" busy={busy}>
          {feedback.alert?.retryable ? i18n.m.catalogEdit.retry : i18n.m.catalogEdit.save}
        </Button>
      </DialogActions>
    </form>
  )
}
